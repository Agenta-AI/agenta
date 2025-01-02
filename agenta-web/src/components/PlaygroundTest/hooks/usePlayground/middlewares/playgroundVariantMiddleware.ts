import {useCallback} from "react"
import {Key, SWRHook} from "swr"
import {type FetcherOptions} from "@/lib/api/types"
import {
    PlaygroundStateData,
    PlaygroundMiddleware,
    VariantUpdateFunction,
    PlaygroundSWRConfig,
    PlaygroundMiddlewareParams,
} from "../types"
import {message} from "antd"
import cloneDeep from "lodash/cloneDeep"
import {
    compareVariant,
    createVariantCompare,
    updatePromptInputKeys,
    findPropertyInObject,
} from "../assets/helpers"
import usePlaygroundUtilities from "./hooks/usePlaygroundUtilities"
import {EnhancedVariant} from "@/components/PlaygroundTest/betterTypes/types"
import isEqual from "lodash/isEqual"

export type ConfigValue = string | boolean | string[] | number | null

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
                    [config, valueReferences],
                ),
            } as PlaygroundSWRConfig<Data>)

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
            }, [swr.mutate, fetcher, projectId, variantId])

            const saveVariant = useCallback(async () => {
                await swr.mutate(
                    async (state) => {
                        if (!state) return state
                        const variant = (state?.variants || []).find((v) => v.id === variantId)
                        if (!variant) return state

                        // try {
                        //     const promptConfig = variant.schema?.promptConfig?.[0]
                        //     const llmConfig = promptConfig?.llm_config
                        //     const messagesConfig = promptConfig?.messages

                        //     const saveResponse = await fetcher?.(
                        //         `/api/variants/${variant.id}/parameters?project_id=${projectId}`,
                        //         {
                        //             method: "PUT",
                        //             body: {
                        //                 parameters: {
                        //                     inputs: [{name: "country"}],
                        //                     ...llmConfig?.value,
                        //                     ...messagesConfig?.value.reduce(
                        //                         (
                        //                             acc: {[key: string]: string},
                        //                             cur: {
                        //                                 role: string
                        //                                 content: string
                        //                             },
                        //                         ) => ({
                        //                             ...acc,
                        //                             [`prompt_${cur.role}`]: cur.content,
                        //                         }),
                        //                         {} as {[key: string]: string},
                        //                     ),
                        //                 },
                        //             },
                        //         },
                        //     )

                        //     if (saveResponse && saveResponse?.status !== 200) {
                        //         // error
                        //         message.error("Failed to save variant")
                        //     } else {
                        //         const x = await fetcher?.(
                        //             `/api/variants/${variant.id}?project_id=${projectId}`,
                        //             {method: "GET"},
                        //         )

                        //         const t = setVariant(x)

                        //         const clonedState = state
                        //         // cloneDeep(state)
                        //         const index = clonedState?.variants?.findIndex(
                        //             (v) => v.id === variant.id,
                        //         )

                        //         const updatedVariant = {
                        //             ...variant,
                        //             ...t,
                        //         }
                        //         clonedState.variants[index] = updatedVariant

                        //         message.success("Changes saved successfully!")

                        //         if (
                        //             clonedState?.dirtyStates &&
                        //             clonedState.dirtyStates.get(updatedVariant.id)
                        //         ) {
                        //             clonedState.dirtyStates = new Map(clonedState.dirtyStates)
                        //             clonedState.dirtyStates.set(updatedVariant.id, false)
                        //             clonedState.dataRef = new Map(clonedState.dataRef)
                        //             clonedState.dataRef.set(
                        //                 updatedVariant.id,
                        //                 cloneDeep(updatedVariant),
                        //             )
                        //         }

                        //         return clonedState
                        //     }

                        //     return state
                        // } catch (err) {
                        //     message.error("Failed to save variant")
                        //     return state
                        // }
                    },
                    {
                        revalidate: false,
                    },
                )
            }, [fetcher, swr.mutate, projectId, variantId])

            /**
             * Pure function to find a property by ID in a variant's prompts
             */
            const findPropertyById = (variant: EnhancedVariant, propertyId?: string) => {
                if (!propertyId || !variant) return undefined

                for (const prompt of variant.prompts) {
                    const found = findPropertyInObject(prompt, propertyId)
                    if (found) return found
                }
                return undefined
            }

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
                            const clonedState = cloneDeep(state)
                            const index = clonedState?.variants?.findIndex(
                                (v) => v.id === variant.id,
                            )
                            clonedState.variants[index] = updatedVariant

                            // Update input keys for all prompts
                            for (const prompt of updatedVariant.prompts) {
                                updatePromptInputKeys(prompt)
                            }

                            return clonedState
                        },
                        {
                            revalidate: false,
                        },
                    )
                },
                [swr.mutate, variantId],
            )

            const handleParamUpdate = useCallback(
                (e: {target: {value: ConfigValue}} | ConfigValue) => {
                    mutateVariant((variant) => {
                        // const variant = state.variants.find((v) => v.id === variantId)
                        if (!variant) return {}

                        const val = e
                            ? typeof e === "object" && "target" in e
                                ? e.target.value
                                : e
                            : null
                        const updatedVariant = cloneDeep(variant)
                        const found = findPropertyById(updatedVariant, config.propertyId)

                        if (found) {
                            found.value = val
                        }

                        return updatedVariant
                    })
                },
                [variantId, config.propertyId, mutateVariant],
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

            return swr
        }
        return useImplementation({key, fetcher, config})
    }
}

export default playgroundVariantMiddleware
