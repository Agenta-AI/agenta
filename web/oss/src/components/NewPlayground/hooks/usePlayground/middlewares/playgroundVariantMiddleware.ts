import {useCallback} from "react"

import type {Key, SWRHook} from "swr"

import {hashVariant, hashResponse} from "@/oss/components/NewPlayground/assets/hash"
import {generateId} from "@/oss/components/NewPlayground/assets/utilities/genericTransformer/utilities/string"
import {getAllMetadata, getMetadataLazy, getSpecLazy} from "@/oss/components/NewPlayground/state"
import {type FetcherOptions} from "@/oss/lib/api/types"

import {transformToRequestBody} from "../../../assets/utilities/transformer/reverseTransformer"
import type {EnhancedVariant} from "../../../assets/utilities/transformer/types"
import {message} from "../../../state/messageContext"
import useWebWorker, {WorkerMessage} from "../../useWebWorker"
import {
    compareVariant,
    createVariantCompare,
    findPropertyInObject,
    findVariantById,
    isPlaygroundEqual,
    setVariant,
} from "../assets/helpers"
import {updateVariantPromptKeys} from "../assets/inputHelpers"
import {createMessageFromSchema} from "../assets/messageHelpers"
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
    for (const prompt of variant.prompts) {
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
                                __isRunning: false,
                                __id: generateId(),
                            }

                            if (targetMessageIndex === targetRow.history.value.length - 1) {
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

                                const responseHash = hashResponse(message.payload.result)
                                inputTestRow.__runs[variantId] = {
                                    __result: responseHash,
                                    __isRunning: false,
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
                    ).then(() => {
                        // then continue with the operation
                        swr.mutate(async (state) => {
                            const variant = (swr.data?.variants || []).find(
                                (v) => v.id === variantId,
                            )
                            if (!variant) return state

                            const _variantId = variant.id
                            try {
                                const deleteResponse = await fetcher?.(
                                    `/api/variants/${_variantId}?project_id=${projectId}`,
                                    {
                                        method: "DELETE",
                                    },
                                )

                                if (deleteResponse && deleteResponse?.status !== 200) {
                                    // error
                                    message.error("Failed to delete variant")
                                }

                                if (state.selected.includes(_variantId)) {
                                    state.selected.splice(state.selected.indexOf(_variantId), 1)
                                }

                                state?.variants?.forEach((v: EnhancedVariant) => {
                                    if (v.id === _variantId) {
                                        const index = state.variants.indexOf(v)
                                        state.variants.splice(index, 1)
                                    }
                                })

                                return state
                            } catch (err) {
                                message.error("Failed to delete variant")
                                return state
                            }
                        })
                    })
                } catch (err) {
                    message.error("Failed to delete variant")
                }
            }, [swr, variantId, fetcher, projectId])

            const saveVariant = useCallback(async () => {
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
                                    const saveResponse = await fetcher?.(
                                        `/api/variants/${variant.id}/parameters?project_id=${projectId}`,
                                        {
                                            method: "PUT",
                                            body: {
                                                parameters,
                                            },
                                        },
                                    )

                                    if (saveResponse && saveResponse?.status !== 200) {
                                        // error
                                        message.error("Failed to save variant")
                                    } else {
                                        const saveResponse = await fetcher?.(
                                            `/api/variants/${variant.id}?project_id=${projectId}`,
                                            {method: "GET", cache: false},
                                        )

                                        const t = setVariant(saveResponse)

                                        const clonedState = state
                                        const index = clonedState?.variants?.findIndex(
                                            (v) => v.id === variant.id,
                                        )

                                        const updatedVariant = {
                                            ...variant,
                                            ...t,
                                        }
                                        updatedVariant.isChat = variant.isChat
                                        updatedVariant.__isMutating = false
                                        clonedState.variants[index] = updatedVariant
                                        message.success("Changes saved successfully!")

                                        clonedState.dataRef = structuredClone(clonedState.dataRef)
                                        if (!clonedState.dataRef) clonedState.dataRef = {}
                                        clonedState.dataRef[updatedVariant.id] =
                                            hashVariant(updatedVariant)

                                        return clonedState
                                    }

                                    return state
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
            }, [swr, variantId, fetcher, projectId])

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
