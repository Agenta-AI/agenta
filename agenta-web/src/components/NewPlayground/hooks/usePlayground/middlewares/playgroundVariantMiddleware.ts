import {useCallback} from "react"

import {message} from "antd"

import {
    compareVariant,
    createVariantCompare,
    findPropertyInObject,
    findVariantById,
    isPlaygroundEqual,
    setVariant,
} from "../assets/helpers"
import usePlaygroundUtilities from "./hooks/usePlaygroundUtilities"
import {
    updateVariantPromptKeys,
    syncVariantInputs,
    getVariantInputKeys,
    getVariantMessages,
    syncVariantMessages,
} from "../assets/inputHelpers"
import {parseValidationError} from "../../../assets/utilities/errors"
import {transformToRequestBody} from "../../../assets/utilities/transformer/reverseTransformer"

import type {Key, SWRHook} from "swr"
import {type FetcherOptions} from "@/lib/api/types"
import type {
    PlaygroundStateData,
    PlaygroundMiddleware,
    VariantUpdateFunction,
    PlaygroundSWRConfig,
    PlaygroundMiddlewareParams,
} from "../types"
import type {ApiResponse, EnhancedVariant} from "../../../assets/utilities/transformer/types"
import useWebWorker from "../../useWebWorker"
import {getAllMetadata, getMetadataLazy} from "@/components/NewPlayground/state"
import {ConfigMetadata} from "@/components/NewPlayground/assets/utilities/genericTransformer/types"

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

    // Search in input rows
    const inputRows = variant.inputs?.value || []
    for (const row of inputRows) {
        const found = findPropertyInObject(row, propertyId)
        if (found) return found
    }

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
            } as PlaygroundSWRConfig<Data>)

            const handleWebWorkerMessage = useCallback(
                (message: {
                    type: string
                    payload: {
                        variant: EnhancedVariant
                        allMetadata: Record<string, ConfigMetadata>
                        rowId: string
                        appId: string
                        uri: string
                        result?: {
                            response?: ApiResponse
                            error?: string
                            metadata: {
                                timestamp: string
                                statusCode?: number
                                rawError?: any
                            }
                        }
                    }
                }) => {
                    const variantId = message.payload.variant.id
                    if (!variantId || !message.payload.result) return
                    if (message.type === "runVariantInputRowResult") {
                        const rowId = message.payload.rowId

                        swr.mutate((clonedState) => {
                            if (!clonedState) return clonedState

                            const inputs = clonedState.generationData.inputs

                            const inputTestRow = inputs.value.find((row) => row.__id === rowId)

                            if (!inputTestRow || !inputTestRow.__runs) return clonedState

                            inputTestRow.__runs[variantId] = {
                                __result: message.payload.result,
                                __isRunning: false,
                            }

                            return clonedState
                        })
                    }
                },
                [swr],
            )

            const {postMessageToWorker, createWorkerMessage} = useWebWorker(
                handleWebWorkerMessage,
                valueReferences.current.includes("runVariantTestRow"),
            )

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

                            try {
                                const deleteResponse = await fetcher?.(
                                    `/api/variants/${variant.id}?project_id=${projectId}`,
                                    {
                                        method: "DELETE",
                                    },
                                )

                                if (deleteResponse && deleteResponse?.status !== 200) {
                                    // error
                                    message.error("Failed to delete variant")
                                }

                                const clonedState = structuredClone(state)
                                clonedState?.variants?.forEach((v: EnhancedVariant) => {
                                    if (v.id === variant.id) {
                                        const index = clonedState.variants.indexOf(v)
                                        clonedState.variants.splice(index, 1)
                                    }
                                })

                                return clonedState
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

                                try {
                                    const parameters = transformToRequestBody(
                                        variant,
                                        undefined,
                                        getAllMetadata(),
                                    )
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
                                            {method: "GET"},
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
                                        updatedVariant.__isMutating = false
                                        clonedState.variants[index] = updatedVariant
                                        message.success("Changes saved successfully!")

                                        if (
                                            clonedState?.dirtyStates &&
                                            clonedState.dirtyStates.get(updatedVariant.id)
                                        ) {
                                            clonedState.dirtyStates = new Map(
                                                clonedState.dirtyStates,
                                            )
                                            clonedState.dirtyStates.set(updatedVariant.id, false)
                                            clonedState.dataRef = new Map(clonedState.dataRef)
                                            clonedState.dataRef.set(
                                                updatedVariant.id,
                                                structuredClone(updatedVariant),
                                            )
                                        }
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
                    swr.mutate(async (clonedState) => {
                        console.log("clonedState: ", clonedState)

                        if (!clonedState) return clonedState

                        const clonedVariant = clonedState?.variants?.find(
                            (v) => v.id === (variantId ?? config.variantId),
                        )

                        if (!clonedVariant) return clonedState

                        // Get current input keys before update
                        const previousInputKeys = getVariantInputKeys(clonedVariant)
                        const previousMessages = getVariantMessages(clonedVariant)

                        const clonedPrevMsg = structuredClone(previousMessages)

                        const updateValues =
                            typeof updates === "function" ? updates(clonedVariant) : updates

                        // if (!variant || !state) return state
                        const updatedVariant: EnhancedVariant = {
                            ...clonedVariant,
                            ...updateValues,
                        }

                        // Update prompt keys
                        updateVariantPromptKeys(updatedVariant)
                        const newMessages = getVariantMessages(updatedVariant)

                        // Get new input keys after update
                        const newInputKeys = getVariantInputKeys(updatedVariant)

                        // Only sync inputs if the keys have changed
                        if (!isPlaygroundEqual(previousInputKeys, newInputKeys)) {
                            clonedState.generationData.inputs = syncVariantInputs(
                                updatedVariant,
                                clonedState.generationData.inputs,
                            )
                        }

                        // TODO: add message synchronization as well
                        if (!isPlaygroundEqual(clonedPrevMsg, newMessages)) {
                            clonedState.generationData.messages = syncVariantMessages(
                                updatedVariant,
                                clonedState.generationData.messages,
                            )
                        }

                        const index = clonedState?.variants?.findIndex(
                            (v) => v.id === clonedVariant.id,
                        )

                        clonedState.variants[index] = updatedVariant

                        return clonedState
                    })
                },
                [swr, variantId],
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
                [config.propertyId, mutateVariant],
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

            /**
             * Runs a specific test row with the current variant configuration
             * @param rowId - ID of the input row to run
             */
            const runVariantTestRow = useCallback(
                async (rowId: string, variantId?: string) => {
                    swr.mutate(async (clonedState) => {
                        const _variantId = variantId ?? config.variantId

                        if (!_variantId || !clonedState) return clonedState

                        const variant = findVariantById(clonedState, _variantId)
                        if (!variant) return clonedState

                        const variantIndex = clonedState.variants.findIndex(
                            (v) => v.id === _variantId,
                        )
                        if (variantIndex === -1) return clonedState

                        const inputRow = clonedState.variants[variantIndex].inputs.value.find(
                            (row) => row.__id === rowId,
                        )
                        if (!inputRow) return clonedState

                        inputRow.__isLoading = true

                        postMessageToWorker(
                            createWorkerMessage("runVariantInputRow", {
                                variant,
                                rowId,
                                appId: config.appId!,
                                uri: variant.uri,
                                allMetadata: getAllMetadata(),
                            }),
                        )

                        return clonedState
                    })
                },
                [swr, config.variantId, config.appId, postMessageToWorker, createWorkerMessage],
            )

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
            Object.defineProperty(swr, "runVariantTestRow", {
                get() {
                    addToValueReferences("runVariantTestRow")
                    return runVariantTestRow
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
