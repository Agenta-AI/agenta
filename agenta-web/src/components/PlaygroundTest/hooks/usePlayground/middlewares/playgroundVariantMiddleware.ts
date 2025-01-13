import {useCallback} from "react"

import {message} from "antd"
import cloneDeep from "lodash/cloneDeep"
import isEqual from "lodash/isEqual"

import {
    compareVariant,
    createVariantCompare,
    findPropertyInObject,
    findVariantById,
    setVariant,
} from "../assets/helpers"
import usePlaygroundUtilities from "./hooks/usePlaygroundUtilities"
import {
    updateVariantPromptKeys,
    syncVariantInputs,
    getVariantInputKeys,
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

export type ConfigValue = string | boolean | string[] | number | null

/**
 * Pure function to find a property by ID in a variant's prompts or inputs
 * TODO: IMPROVE PERFORMANCE
 */
const findPropertyById = (variant: EnhancedVariant, propertyId?: string) => {
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

                            return isEqual(prevProperty?.value, nextProperty?.value)
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
                        rowId: string
                        appId: string
                        uri: string
                        service: string
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
                    const variantId = config.variantId

                    if (!variantId || !message.payload.result) return
                    if (message.type === "runVariantInputRowResult") {
                        const rowId = message.payload.rowId

                        swr.mutate((state) => {
                            const clonedState = cloneDeep(state)
                            if (!clonedState) return state

                            const variant = findVariantById(state, variantId)
                            if (!variant) return clonedState

                            const variantIndex = clonedState.variants.findIndex(
                                (v) => v.id === config.variantId,
                            )
                            if (variantIndex === -1) return clonedState

                            const inputRow = clonedState.variants[variantIndex].inputs.value.find(
                                (row) => row.__id === rowId,
                            )

                            if (!inputRow) return clonedState

                            inputRow.__result = message.payload.result
                            inputRow.__isLoading = false

                            return clonedState
                        })
                    }
                },
                [config.variantId, swr],
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
                await swr.mutate(
                    async (state) => {
                        const variant = (swr.data?.variants || []).find((v) => v.id === variantId)
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

                            const clonedState = cloneDeep(state)
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
                    },
                    {
                        revalidate: false,
                    },
                )
            }, [swr, variantId, fetcher, projectId])

            const saveVariant = useCallback(async () => {
                await swr.mutate(
                    async (state) => {
                        if (!state) return state
                        const variant = (state?.variants || []).find((v) => v.id === variantId)
                        if (!variant) return state

                        try {
                            const parameters = transformToRequestBody(variant)
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
                                clonedState.variants[index] = updatedVariant
                                message.success("Changes saved successfully!")

                                if (
                                    clonedState?.dirtyStates &&
                                    clonedState.dirtyStates.get(updatedVariant.id)
                                ) {
                                    clonedState.dirtyStates = new Map(clonedState.dirtyStates)
                                    clonedState.dirtyStates.set(updatedVariant.id, false)
                                    clonedState.dataRef = new Map(clonedState.dataRef)
                                    clonedState.dataRef.set(
                                        updatedVariant.id,
                                        cloneDeep(updatedVariant),
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
            }, [swr, variantId, fetcher, projectId])

            /**
             * Updates the current variant with new properties
             * @param updates - Partial variant object containing the properties to update
             */
            const mutateVariant = useCallback(
                async (updates: Partial<EnhancedVariant> | VariantUpdateFunction) => {
                    swr.mutate(
                        async (state) => {
                            if (!state) return state

                            const variant = state?.variants?.find((v) => v.id === variantId)
                            const clonedVariant = cloneDeep(variant)

                            if (!clonedVariant) return state

                            const updateValues =
                                typeof updates === "function" ? updates(clonedVariant) : updates

                            if (!variant || !state) return state
                            const updatedVariant: EnhancedVariant = {...variant, ...updateValues}

                            // Get current input keys before update
                            const previousInputKeys = getVariantInputKeys(variant)

                            // Update prompt keys
                            updateVariantPromptKeys(updatedVariant)

                            // Get new input keys after update
                            const newInputKeys = getVariantInputKeys(updatedVariant)

                            // Only sync inputs if the keys have changed
                            if (!isEqual(previousInputKeys, newInputKeys)) {
                                syncVariantInputs(updatedVariant)
                            }

                            const clonedState = cloneDeep(state)
                            const index = clonedState?.variants?.findIndex(
                                (v) => v.id === variant.id,
                            )

                            clonedState.variants[index] = updatedVariant

                            return clonedState
                        },
                        {revalidate: false},
                    )
                },
                [swr, variantId],
            )

            const handleParamUpdate = useCallback(
                (e: {target: {value: ConfigValue}} | ConfigValue) => {
                    mutateVariant((variant) => {
                        if (!variant) return {}

                        const val = e
                            ? typeof e === "object" && "target" in e
                                ? e.target.value
                                : e
                            : null
                        const updatedVariant = variant
                        const found = findPropertyById(updatedVariant, config.propertyId)

                        if (found) {
                            found.value = val
                        }

                        return updatedVariant
                    })
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
                          handleChange: handleParamUpdate,
                      }
                    : undefined
            }, [swr.data?.variants, config.propertyId, handleParamUpdate, variantId])

            /**
             * Runs a specific test row with the current variant configuration
             * @param rowId - ID of the input row to run
             */
            const runVariantTestRow = useCallback(
                async (rowId: string) => {
                    swr.mutate(async (state) => {
                        const clonedState = cloneDeep(state)

                        if (!config.variantId || !config.service || !clonedState) return state

                        const variant = findVariantById(state, config.variantId)
                        if (!variant) return state

                        const variantIndex = clonedState.variants.findIndex(
                            (v) => v.id === config.variantId,
                        )
                        if (variantIndex === -1) return state

                        const inputRow = clonedState.variants[variantIndex].inputs.value.find(
                            (row) => row.__id === rowId,
                        )
                        if (!inputRow) return state

                        inputRow.__isLoading = true

                        postMessageToWorker(
                            createWorkerMessage("runVariantInputRow", {
                                variant,
                                rowId,
                                service: config.service,
                                appId: config.appId!,
                                // apiUrl: getAgentaApiUrl()!,
                                uri: variant.uri,
                            }),
                        )

                        return clonedState
                    })
                },
                [
                    swr,
                    config.variantId,
                    config.service,
                    config.appId,
                    postMessageToWorker,
                    createWorkerMessage,
                ],
            )

            Object.defineProperty(swr, "variant", {
                get() {
                    checkInvalidSelector()
                    addToValueReferences("variant")
                    const variant = swr.data?.variants.find((v) => v.id === config.variantId)
                    return variant
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
                    checkInvalidSelector()
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
                    checkInvalidSelector()
                    addToValueReferences("runVariantTestRow")
                    return runVariantTestRow
                },
            })

            return swr
        }
        return useImplementation({key, fetcher, config})
    }
}

export default playgroundVariantMiddleware
