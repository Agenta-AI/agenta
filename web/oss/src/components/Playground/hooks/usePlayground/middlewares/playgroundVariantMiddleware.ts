import {useCallback} from "react"

import JSON5 from "json5"
import type {Key, SWRHook} from "swr"

import {message} from "@/oss/components/AppMessageContext"
import {hashVariant, hashResponse} from "@/oss/components/Playground/assets/hash"
import {type FetcherOptions} from "@/oss/lib/api/types"
import {useGlobalVariantsRefetch} from "@/oss/lib/hooks/useStatelessVariants"
import {
    getAllMetadata,
    getMetadataLazy,
    getSpecLazy,
    atomStore,
    allRevisionsAtom,
} from "@/oss/lib/hooks/useStatelessVariants/state"
import {fetchAndProcessRevisions} from "@/oss/lib/shared/variant"
import {updateVariantPromptKeys} from "@/oss/lib/shared/variant/inputHelpers"
import {generateId} from "@/oss/lib/shared/variant/stringUtils"
import {transformToRequestBody} from "@/oss/lib/shared/variant/transformer/transformToRequestBody"
import {deleteSingleVariantRevision} from "@/oss/services/playground/api"

import type {EnhancedVariant} from "../../../../../lib/shared/variant/transformer/types"
import useWebWorker, {WorkerMessage} from "../../useWebWorker"
import {
    compareVariant,
    createVariantCompare,
    findPropertyInObject,
    findVariantById,
    isPlaygroundEqual,
} from "../assets/helpers"
import {createMessageFromSchema} from "../assets/messageHelpers"
import {updateStateWithProcessedRevisions} from "../assets/stateHelpers"
import type {
    PlaygroundStateData,
    PlaygroundMiddleware,
    VariantUpdateFunction,
    PlaygroundSWRConfig,
    PlaygroundMiddlewareParams,
    PlaygroundResponse,
} from "../types"

import usePlaygroundUtilities from "./hooks/usePlaygroundUtilities"

export type ConfigValue = string | boolean | string[] | number | null

/**
 * Pure function to find a property by ID in a variant's prompts or inputs
 * TODO: IMPROVE PERFORMANCE
 */
export const findPropertyById = (variant: EnhancedVariant, propertyId?: string) => {
    if (!propertyId || !variant) return undefined

    // Search in prompts
    for (const prompt of variant.prompts || []) {
        const found = findPropertyInObject(prompt, propertyId)
        if (found) return found
    }

    const found = findPropertyInObject(variant.customProperties, propertyId)
    if (found) return found

    return undefined
}

const playgroundVariantMiddleware: PlaygroundMiddleware = <
    Data extends PlaygroundStateData = PlaygroundStateData,
    Selected = unknown,
>(
    useSWRNext: SWRHook,
) => {
    return (
        key: Key,
        fetcher: ((url: string, options?: FetcherOptions) => Promise<Data>) | null,
        config: PlaygroundSWRConfig<Data, Selected>,
    ) => {
        const useImplementation = ({key, fetcher, config}: PlaygroundMiddlewareParams<Data>) => {
            const {logger, valueReferences, addToValueReferences, checkInvalidSelector} =
                usePlaygroundUtilities({
                    config: {
                        ...config,
                        name: "playgroundVariantMiddleware",
                    },
                })
            const refetchVariants = useGlobalVariantsRefetch()
            const {variantId, projectId} = config

            const swr = useSWRNext(key, fetcher, {
                ...config,
                revalidateOnFocus: false,
                revalidateOnReconnect: false,
                revalidateIfStale: false,
                revalidateOnMount:
                    config.revalidateOnMount ??
                    !(
                        valueReferences.current.includes("variant") ||
                        valueReferences.current.includes("variantConfig") ||
                        valueReferences.current.includes("variantConfigProperty")
                    ),
                compare: useCallback(
                    (a?: Data, b?: Data) => {
                        logger(`COMPARE - ENTER`)

                        const variantReferenced =
                            valueReferences.current.includes("variant") ||
                            valueReferences.current.includes("variantConfig") ||
                            valueReferences.current.includes("variantConfigProperty")

                        const wrappedComparison = config.compare?.(a, b)

                        if (!variantReferenced) {
                            logger(`COMPARE - WRAPPED`, wrappedComparison, a, b)
                            return wrappedComparison ?? true
                        }

                        const {variantId} = config
                        if (wrappedComparison) {
                            logger(
                                `COMPARE - VARIANT REFERENCED - return wrapped`,
                                wrappedComparison,
                            )
                            return true
                        }

                        if (!variantId) return wrappedComparison

                        logger(
                            `COMPARE - VARIANT REFERENCED - return COMPARISON`,
                            wrappedComparison,
                        )

                        const isConfigReferenced = valueReferences.current.includes("variantConfig")
                        const isConfigPropertyReferenced =
                            valueReferences.current.includes("variantConfigProperty")

                        if (isConfigPropertyReferenced) {
                            // Compare variants by checking if the specific property changed
                            const prevVariant = (a?.variants || []).find((v) => v.id === variantId)
                            const nextVariant = (b?.variants || []).find((v) => v.id === variantId)

                            const prevProperty =
                                prevVariant && findPropertyById(prevVariant, config.propertyId)
                            const nextProperty =
                                nextVariant && findPropertyById(nextVariant, config.propertyId)

                            return isPlaygroundEqual(prevProperty?.value, nextProperty?.value)
                        } else if (isConfigReferenced) {
                            return createVariantCompare()(a, b)
                        } else {
                            return compareVariant(a, b, variantId)
                        }
                    },
                    [config, logger, valueReferences],
                ),
            } as PlaygroundSWRConfig<Data>) as PlaygroundResponse<Data, Selected>

            const handleWebWorkerChatMessage = useCallback(
                (message: WorkerMessage) => {
                    // if (!variantId) return
                    // if (message.payload.variant.id !== variantId) return
                    const variantId = message.payload.variant.id
                    // HANDLE INCOMING CHAT
                    const rowId = message.payload.rowId
                    swr.mutate((clonedState) => {
                        if (!clonedState) return clonedState

                        const targetRow = clonedState.generationData.messages.value.find(
                            (row) => row.__id === rowId,
                        )

                        if (!targetRow) return clonedState

                        const targetMessageId = message.payload.messageId
                        const targetMessageIndex = targetRow.history.value.findIndex(
                            (msg) => msg.__id === targetMessageId,
                        )

                        if (targetMessageIndex >= 0) {
                            const targetMessage = targetRow.history.value[targetMessageIndex]

                            if (
                                targetMessage.__runs &&
                                targetMessage.__runs[variantId]?.__isRunning !==
                                    message.payload.runId
                            )
                                return clonedState

                            const metadata = getMetadataLazy(targetMessage.__metadata)
                            if (!metadata) return clonedState

                            const incomingMessage = createMessageFromSchema(
                                metadata,
                                message?.payload?.result?.error
                                    ? {
                                          role: "Error",
                                          content: message.payload.result?.error,
                                      }
                                    : message.payload.result.response?.data,
                            )

                            const responseHash = hashResponse(message.payload.result)
                            if (!targetMessage.__runs) targetMessage.__runs = {}

                            targetMessage.__runs[variantId] = {
                                __result: responseHash,
                                message: incomingMessage,
                                __isRunning: "",
                                __id: generateId(),
                            }

                            let hasToolCall = false
                            if (
                                incomingMessage &&
                                incomingMessage.role?.value === "assistant" &&
                                incomingMessage.toolCalls?.value?.length
                            ) {
                                hasToolCall = true
                                const toolMessage = createMessageFromSchema(metadata, {
                                    role: "tool",
                                    name: incomingMessage.toolCalls.value[0]?.function.name,
                                    toolCallId: incomingMessage.toolCalls.value[0]?.id,
                                    content: "",
                                })
                                targetMessage.__runs[variantId] = {
                                    __result: responseHash,
                                    message: incomingMessage,
                                    messages: [incomingMessage, toolMessage],
                                    __isRunning: "",
                                    __id: generateId(),
                                }
                            }

                            if (
                                !hasToolCall &&
                                !message?.payload?.result?.error &&
                                targetMessageIndex === targetRow.history.value.length - 1
                            ) {
                                const emptyMessage = createMessageFromSchema(metadata, {
                                    role: "user",
                                })
                                if (emptyMessage) {
                                    targetRow.history.value.push(emptyMessage)
                                }
                            }
                        }

                        return clonedState
                    })
                },
                [swr],
            )

            const handleWebWorkerMessage = useCallback(
                (message: WorkerMessage) => {
                    if (message.payload.variant.id !== config.variantId) return
                    if (message.payload.rowId !== config.rowId) return

                    const variantId = message.payload.variant.id
                    if (!variantId || !message.payload.result) return
                    if (message.type === "runVariantInputRowResult") {
                        if (message.payload.variant.isChat) {
                            handleWebWorkerChatMessage(message)
                        } else {
                            const rowId = message.payload.rowId

                            swr.mutate((clonedState) => {
                                if (!clonedState) return clonedState

                                const inputs = clonedState.generationData.inputs

                                const inputTestRow = inputs.value.find((row) => row.__id === rowId)

                                if (!inputTestRow || !inputTestRow.__runs) return clonedState

                                // do not handle this message if the runId does not match the id generated when starting this flow
                                if (
                                    inputTestRow.__runs[variantId]?.__isRunning !==
                                    message.payload.runId
                                )
                                    return clonedState

                                try {
                                    const parsed = JSON5.parse(
                                        message.payload.result?.response?.data,
                                    )
                                    if (parsed && Array.isArray(parsed)) {
                                        const toolCalls = parsed
                                            .filter((item) => {
                                                return (
                                                    item &&
                                                    typeof item === "object" &&
                                                    item.type === "function"
                                                )
                                            })
                                            .map((toolCall) => {
                                                return {
                                                    role: "assistant",
                                                    content: JSON.stringify(toolCall, null, 2),
                                                }
                                            })
                                        const responseHash = hashResponse({
                                            response: toolCalls,
                                        })
                                        inputTestRow.__runs[variantId] = {
                                            __id: generateId(),
                                            __toolCall: true,
                                            __result: responseHash,
                                            __isRunning: "",
                                        }
                                    } else {
                                        const responseHash = hashResponse(message.payload.result)

                                        inputTestRow.__runs[variantId] = {
                                            __result: responseHash,
                                            __isRunning: "",
                                        }
                                    }
                                } catch (err) {
                                    const responseHash = hashResponse(message.payload.result)

                                    inputTestRow.__runs[variantId] = {
                                        __result: responseHash,
                                        __isRunning: "",
                                    }
                                }

                                return clonedState
                            })
                        }
                    }
                },
                [config.rowId, config.variantId, handleWebWorkerChatMessage, swr],
            )

            useWebWorker(handleWebWorkerMessage, config.registerToWebWorker && !!variantId)

            /**
             * Deletes the current variant from the server and updates local state
             * @returns Promise that resolves when the deletion is complete
             */
            const deleteVariant = useCallback(async () => {
                try {
                    return new Promise<void>((res) => {
                        swr.mutate(
                            (clonedState) => {
                                const variant = findVariantById(clonedState, variantId!)
                                if (!variant) throw new Error("Variant not found")

                                variant.__isMutating = true
                                return clonedState
                            },
                            {
                                revalidate: false,
                            },
                        ).then(() => {
                            // then continue with the operation
                            swr.mutate(
                                async (state) => {
                                    const variant = (swr.data?.variants || []).find(
                                        (v) => v.id === variantId,
                                    )
                                    if (!variant) return state

                                    const _variantId = variant.id
                                    try {
                                        await deleteSingleVariantRevision(
                                            variant.variantId,
                                            variant.id,
                                        )

                                        if (state.selected.includes(_variantId)) {
                                            state.selected.splice(
                                                state.selected.indexOf(_variantId),
                                                1,
                                            )
                                            state.selected = state.selected.filter(Boolean)
                                            state.availableRevisions?.splice(
                                                state.availableRevisions.findIndex(
                                                    (ar) => ar.id === _variantId,
                                                ),
                                                1,
                                            )
                                        }

                                        if (!state.selected.length) {
                                            const newId = (
                                                state.availableRevisions?.find(
                                                    (rev) => rev.isLatestRevision,
                                                ) ||
                                                state.availableRevisions?.sort(
                                                    (a, b) =>
                                                        b.createdAtTimestamp - a.createdAtTimestamp,
                                                )?.[0]
                                            )?.id

                                            if (newId) {
                                                state.selected.push(newId)
                                                const allRevisions =
                                                    atomStore.get(allRevisionsAtom) || []
                                                const selectedRevision = allRevisions.find(
                                                    (rev: {id: string}) => rev.id === newId,
                                                )
                                                if (selectedRevision) {
                                                    // Replace variants with just the selected one from our atom
                                                    state.variants = [selectedRevision]
                                                } else {
                                                    console.warn(
                                                        "Selected variant not found in atom store:",
                                                        variantId,
                                                    )
                                                }
                                            }
                                        }

                                        refetchVariants()
                                        return state
                                    } catch (err) {
                                        message.error("Failed to delete variant")
                                        return state
                                    }
                                },
                                {
                                    revalidate: false,
                                },
                            ).then(() => {
                                res()
                            })
                        })
                    })
                    // first set the mutation state of the variant to true
                } catch (err) {
                    message.error("Failed to delete variant")
                }
            }, [swr, variantId, fetcher, projectId])

            const saveVariant = useCallback(
                async (note?: string, callback?: (variant: EnhancedVariant) => void) => {
                    try {
                        // first set the mutation state of the variant to true
                        swr.mutate(
                            (clonedState) => {
                                const variant = findVariantById(clonedState, variantId!)
                                if (!variant) throw new Error("Variant not found")

                                variant.__isMutating = true
                                return clonedState
                            },
                            {
                                revalidate: false,
                            },
                        ).then(async (data) => {
                            // then continue with the operation
                            swr.mutate(
                                async (state) => {
                                    if (!state) return state
                                    const variant = (state?.variants || []).find(
                                        (v) => v.id === variantId,
                                    )
                                    if (!variant) return state
                                    const spec = getSpecLazy()

                                    if (!spec) return state

                                    try {
                                        const parameters = transformToRequestBody({
                                            variant,
                                            allMetadata: getAllMetadata(),
                                            spec,
                                            routePath: state.uri?.routePath,
                                        })
                                        // Attempt to save the variant parameters with a commit message
                                        await fetcher?.(
                                            `/api/variants/${variant.variantId}/parameters?project_id=${projectId}`,
                                            {
                                                method: "PUT",
                                                body: {
                                                    parameters: parameters.ag_config,
                                                    commit_message: note,
                                                },
                                            },
                                        )

                                        // Since the API doesn't return the updated data after PUT,
                                        // we need to fetch the latest variant data explicitly
                                        try {
                                            // Fetch the latest variant data to confirm the update was successful
                                            const latestVariantData = await fetcher?.(
                                                `/api/variants/${variant.variantId}?project_id=${projectId}`,
                                                {method: "GET"},
                                            )

                                            if (!latestVariantData) {
                                                throw new Error(
                                                    "Failed to fetch updated variant data",
                                                )
                                            }
                                        } catch (fetchError) {
                                            console.error(
                                                "Error fetching updated variant data:",
                                                fetchError,
                                            )
                                            message.error(
                                                "Saved variant but couldn't verify the update",
                                            )
                                        }

                                        // Continue with updating the state regardless of verification result
                                        // When saving a variant, a new revision is created on the backend
                                        // We need to fetch the complete set of revisions to get the newly created one
                                        message.loading("Updating playground with new revision...")
                                        try {
                                            // Get all revisions for this app, including the new one
                                            const {
                                                revisions: processedRevisions,
                                                spec,
                                                uri,
                                            } = await fetchAndProcessRevisions({
                                                appId: config.appId || "",
                                                appType: config.appType || "",
                                                projectId: projectId || "",
                                                forceRefresh: true, // Force refresh to get the new revision
                                                logger: console.log,
                                                keyParts: "playground",
                                            })

                                            // Create a deep clone of the state to avoid mutation issues
                                            // const clonedState = structuredClone(state)

                                            // Use our shared utility to update the state with the fresh revisions
                                            const updatedState = updateStateWithProcessedRevisions(
                                                state,
                                                processedRevisions,
                                                spec,
                                                uri,
                                            ) as typeof state

                                            // Find the latest revision for the current variant by timestamp
                                            // Filter revisions for the current variant and sort by timestamp (newest first)
                                            const newRevision = processedRevisions
                                                .filter(
                                                    (rev) => rev.variantId === variant.variantId,
                                                )
                                                .sort(
                                                    (a, b) =>
                                                        b.createdAtTimestamp - a.createdAtTimestamp,
                                                )[0]
                                            // Additional verification could be added here to compare parameters
                                            // with what was sent in the request if needed

                                            if (newRevision) {
                                                callback?.(newRevision)

                                                // Find the index of the variant we're updating to preserve its position
                                                const index = updatedState.variants.findIndex(
                                                    (v) => v.variantId === variant.variantId,
                                                )

                                                // Find the old variant that we're replacing
                                                const oldVariant =
                                                    index !== -1
                                                        ? updatedState.variants[index]
                                                        : null

                                                // Preserve any UI state or props from the old variant that might be needed
                                                if (oldVariant) {
                                                    // Copy any UI-specific properties that shouldn't be lost during replacement
                                                    // Use a type-safe approach with a dynamic property assignment
                                                    // This preserves UI state without TypeScript errors
                                                    const oldUiState =
                                                        (oldVariant as any).__uiState || {}
                                                    ;(newRevision as any).__uiState = oldUiState
                                                }

                                                // Create a new variants array with the new revision at the same position
                                                if (index !== -1) {
                                                    // Get the original pristine variant from the atom store
                                                    const allRevisions =
                                                        atomStore.get(allRevisionsAtom) || []
                                                    const pristineVariant = allRevisions.find(
                                                        (rev: {id: string}) =>
                                                            rev.id === oldVariant?.id,
                                                    )

                                                    // Create a new variants array to maintain UI state
                                                    const newVariants = [...updatedState.variants]

                                                    // Add the new revision
                                                    newVariants[index] = newRevision

                                                    // If we found the pristine variant, restore it to its original state
                                                    // and add it back to the variants array (but not in the selected array)
                                                    if (pristineVariant && oldVariant) {
                                                        // Preserve UI state for the pristine variant
                                                        const oldUiState =
                                                            (oldVariant as any).__uiState || {}
                                                        const pristineWithUiState = {
                                                            ...pristineVariant,
                                                        }
                                                        ;(pristineWithUiState as any).__uiState =
                                                            oldUiState

                                                        // Find if the pristine variant is already in the array
                                                        const pristineIndex = newVariants.findIndex(
                                                            (v) => v.id === pristineVariant.id,
                                                        )

                                                        // Replace or add the pristine variant
                                                        if (
                                                            pristineIndex !== -1 &&
                                                            pristineIndex !== index
                                                        ) {
                                                            newVariants[pristineIndex] =
                                                                pristineWithUiState
                                                        }

                                                        // Update dataRef for the pristine variant to mark it as not dirty
                                                        if (updatedState.dataRef) {
                                                            updatedState.dataRef[
                                                                pristineVariant.id
                                                            ] = hashVariant(pristineVariant)
                                                        }
                                                    }

                                                    updatedState.variants = newVariants
                                                } else {
                                                    // If not found (unlikely), just add it to the end
                                                    updatedState.variants = [
                                                        ...updatedState.variants,
                                                        newRevision,
                                                    ]
                                                }

                                                // Update the selection to point to the new revision
                                                // We need to check both the variant.id and variant.variantId since
                                                // selected might contain either depending on how it was added
                                                updatedState.selected = updatedState.selected.map(
                                                    (id) => {
                                                        // Check if this ID matches either the variant ID or variantId
                                                        if (
                                                            id === variant.id ||
                                                            id === variant.variantId
                                                        ) {
                                                            return newRevision.id
                                                        }
                                                        return id
                                                    },
                                                )

                                                // Update the dataRef to track the new revision
                                                updatedState.dataRef = structuredClone(
                                                    updatedState.dataRef || {},
                                                )
                                                updatedState.dataRef[newRevision.id] =
                                                    hashVariant(newRevision)

                                                message.success("Variant saved successfully")
                                                refetchVariants()
                                                return updatedState
                                            } else {
                                                // If we couldn't find the new revision, just return the updated state anyway
                                                message.warning(
                                                    "Variant saved but couldn't find the new revision",
                                                )
                                                return updatedState
                                            }
                                        } catch (error) {
                                            message.error("Error updating revision state")
                                            return state
                                        }
                                    } catch (err) {
                                        message.error("Failed to save variant")
                                        return state
                                    }
                                },
                                {
                                    revalidate: false,
                                },
                            )
                        })
                    } catch (err) {
                        message.error("Failed to save variant")
                    }
                },
                [swr, variantId, fetcher, projectId],
            )

            /**
             * Updates the current variant with new properties
             * @param updates - Partial variant object containing the properties to update
             */
            const mutateVariant = useCallback(
                async (
                    updates: Partial<EnhancedVariant> | VariantUpdateFunction,
                    variantId?: string,
                ) => {
                    swr.mutate(
                        async (clonedState) => {
                            if (!clonedState) return clonedState

                            const clonedVariant = clonedState?.variants?.find(
                                (v) => v.id === (variantId ?? config.variantId),
                            )

                            if (!clonedVariant) return clonedState
                            const updateValues =
                                typeof updates === "function" ? updates(clonedVariant) : updates

                            // if (!variant || !state) return state
                            const updatedVariant: EnhancedVariant = {
                                ...clonedVariant,
                                ...updateValues,
                            }

                            // Update prompt keys
                            if (!updatedVariant.isCustom) {
                                // @ts-ignore
                                updateVariantPromptKeys(updatedVariant)
                            }

                            const index = clonedState?.variants?.findIndex(
                                (v) => v.id === clonedVariant.id,
                            )

                            clonedState.variants[index] = updatedVariant

                            return clonedState
                        },
                        {
                            variantId,
                        },
                    )
                },
                [swr, config.variantId],
            )

            const handleParamUpdate = useCallback(
                (
                    e: {target: {value: ConfigValue}} | ConfigValue,
                    propertyId?: string,
                    variantId?: string,
                ) => {
                    mutateVariant((variant) => {
                        if (!variant) return {}

                        const val = e
                            ? typeof e === "object" && "target" in e
                                ? e.target.value
                                : e
                            : null

                        const updatedVariant = variant
                        const found = findPropertyById(
                            updatedVariant,
                            propertyId ?? config.propertyId,
                        )

                        if (found) {
                            found.value = val
                        }

                        return updatedVariant
                    }, variantId ?? config.variantId)
                },
                [config.propertyId, config.variantId, mutateVariant],
            )

            const getVariantConfigProperty = useCallback(() => {
                const variant = swr.data?.variants.find((v) => v.id === variantId)
                if (!variant) return {}
                const found = findPropertyById(variant, config.propertyId)

                return found
                    ? {
                          ...found,
                          __metadata: getMetadataLazy(found.__metadata),
                          handleChange: handleParamUpdate,
                      }
                    : undefined
            }, [swr, variantId, config.propertyId, handleParamUpdate])

            Object.defineProperty(swr, "variant", {
                get() {
                    addToValueReferences("variant")
                    if (config.variantId) {
                        const variant = swr.data?.variants.find((v) => v.id === config.variantId)
                        return variant
                    } else {
                        return undefined
                    }
                },
            })

            Object.defineProperty(swr, "handleParamUpdate", {
                get() {
                    addToValueReferences("variantConfig")
                    return handleParamUpdate
                },
            })

            Object.defineProperty(swr, "variantConfig", {
                get() {
                    checkInvalidSelector()
                    addToValueReferences("variantConfig")
                },
            })
            Object.defineProperty(swr, "variantConfigProperty", {
                get() {
                    checkInvalidSelector()
                    addToValueReferences("variantConfigProperty")
                    return getVariantConfigProperty()
                },
            })
            Object.defineProperty(swr, "deleteVariant", {
                get() {
                    checkInvalidSelector()
                    addToValueReferences("deleteVariant")
                    return deleteVariant
                },
            })
            Object.defineProperty(swr, "mutateVariant", {
                get() {
                    addToValueReferences("mutateVariant")
                    return mutateVariant
                },
            })
            Object.defineProperty(swr, "saveVariant", {
                get() {
                    checkInvalidSelector()
                    addToValueReferences("saveVariant")
                    return saveVariant
                },
            })
            Object.defineProperty(swr, "handleWebWorkerMessage", {
                get() {
                    return handleWebWorkerMessage
                },
            })

            return swr
        }
        return useImplementation({key, fetcher, config})
    }
}

export default playgroundVariantMiddleware
