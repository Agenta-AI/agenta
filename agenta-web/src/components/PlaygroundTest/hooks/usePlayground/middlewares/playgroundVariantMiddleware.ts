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
import {StateVariant} from "../../../state/types"
import {message} from "antd"
import cloneDeep from "lodash/cloneDeep"
import {compareVariant, createVariantCompare, setVariant} from "../assets/helpers"
import usePlaygroundUtilities from "./hooks/usePlaygroundUtilities"
import {accessKeyInVariant, setKeyInVariant} from "@/components/PlaygroundTest/assets/helpers"
import {isSchemaObject} from "@/components/PlaygroundTest/Components/PlaygroundVariantPropertyControl/assets/helpers"

export type ConfigValue = string | boolean | string[] | number | null

const playgroundVariantMiddleware: PlaygroundMiddleware = (useSWRNext: SWRHook) => {
    return <Data extends PlaygroundStateData = PlaygroundStateData>(
        key: Key,
        fetcher: ((url: string, options?: FetcherOptions) => Promise<Data>) | null,
        config: PlaygroundSWRConfig<Data>,
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

                        const {configKey, valueKey, variantId} = config
                        if (wrappedComparison) {
                            logger(
                                `COMPARE - VARIANT REFERENCED - return wrapped`,
                                wrappedComparison,
                            )
                            return true
                        } else {
                            if (!variantId) {
                                return wrappedComparison
                            }

                            logger(
                                `COMPARE - VARIANT REFERENCED - return COMPARISON`,
                                wrappedComparison,
                            )

                            const isConfigReferenced =
                                valueReferences.current.includes("variantConfig")
                            const isConfigPropertyReferenced =
                                valueReferences.current.includes("variantConfigProperty")

                            if (isConfigPropertyReferenced && configKey && valueKey) {
                                logger(`COMPARE - VARIANT CONFIG PROPERTY REFERENCED`)
                                return (
                                    compareVariant(a, b, variantId, undefined, configKey) &&
                                    compareVariant(a, b, variantId, undefined, valueKey)
                                )
                            } else if (isConfigReferenced) {
                                logger(`COMPARE - VARIANT CONFIG REFERENCED`)
                                // TODO REPLACE THIS
                                return createVariantCompare()(a, b)
                            } else {
                                logger(`COMPARE - VARIANT REFERENCED`, createVariantCompare()(a, b))
                                // return createVariantCompare()(a, b)
                                return compareVariant(a, b, variantId)
                            }
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
                        const variant = (swr.data?.variants || []).find(
                            (v) => v.variantId === variantId,
                        )
                        if (!variant) return state

                        try {
                            const deleteResponse = await fetcher?.(
                                `/api/variants/${variant.variantId}?project_id=${projectId}`,
                                {
                                    method: "DELETE",
                                },
                            )

                            if (deleteResponse && deleteResponse?.status !== 200) {
                                // error
                                message.error("Failed to delete variant")
                            }

                            const clonedState = cloneDeep(state)
                            clonedState?.variants?.forEach((v: StateVariant) => {
                                if (v.variantId === variant.variantId) {
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
                        const variant = (state?.variants || []).find(
                            (v) => v.variantId === variantId,
                        )
                        if (!variant) return state

                        try {
                            const promptConfig = variant.schema?.promptConfig?.[0]
                            const llmConfig = promptConfig?.llm_config
                            const messagesConfig = promptConfig?.messages

                            const saveResponse = await fetcher?.(
                                `/api/variants/${variant.variantId}/parameters?project_id=${projectId}`,
                                {
                                    method: "PUT",
                                    body: {
                                        parameters: {
                                            inputs: [{name: "country"}],
                                            ...llmConfig?.value,
                                            ...messagesConfig?.value.reduce(
                                                (
                                                    acc: {[key: string]: string},
                                                    cur: {
                                                        role: string
                                                        content: string
                                                    },
                                                ) => ({
                                                    ...acc,
                                                    [`prompt_${cur.role}`]: cur.content,
                                                }),
                                                {} as {[key: string]: string},
                                            ),
                                        },
                                    },
                                },
                            )

                            if (saveResponse && saveResponse?.status !== 200) {
                                // error
                                message.error("Failed to save variant")
                            } else {
                                const x = await fetcher?.(
                                    `/api/variants/${variant.variantId}?project_id=${projectId}`,
                                    {method: "GET"},
                                )

                                const t = setVariant(x)

                                const clonedState = state
                                // cloneDeep(state)
                                const index = clonedState?.variants?.findIndex(
                                    (v) => v.variantId === variant.variantId,
                                )

                                const updatedVariant = {
                                    ...variant,
                                    ...t,
                                }
                                clonedState.variants[index] = updatedVariant

                                message.success("Changes saved successfully!")

                                if (
                                    clonedState?.dirtyStates &&
                                    clonedState.dirtyStates.get(updatedVariant.variantId)
                                ) {
                                    clonedState.dirtyStates = new Map(clonedState.dirtyStates)
                                    clonedState.dirtyStates.set(updatedVariant.variantId, false)
                                    clonedState.dataRef = new Map(clonedState.dataRef)
                                    clonedState.dataRef.set(
                                        updatedVariant.variantId,
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
            }, [fetcher, swr.mutate, projectId, variantId])

            /**
             * Updates the current variant with new properties
             * @param updates - Partial variant object containing the properties to update
             */
            const mutateVariant = useCallback(
                async (updates: Partial<StateVariant> | VariantUpdateFunction) => {
                    swr.mutate(
                        async (state) => {
                            if (!state) return state
                            const updateValues =
                                typeof updates === "function" ? updates(state) : updates
                            const variant = state?.variants?.find((v) => v.variantId === variantId)
                            if (!variant || !state) return state
                            const updatedVariant: StateVariant = {...variant, ...updateValues}
                            const clonedState = cloneDeep(state)
                            const index = clonedState?.variants?.findIndex(
                                (v) => v.variantId === variant.variantId,
                            )
                            clonedState.variants[index] = updatedVariant

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
                    const valueKey = config.valueKey
                    if (!valueKey) {
                        throw new Error(
                            "Cannot update variant value without a valueKey in the config",
                        )
                    }
                    mutateVariant((state) => {
                        const variant = state.variants.find((v) => v.variantId === variantId)
                        if (!variant) return {} // Return empty object instead of undefined

                        const val = e
                            ? typeof e === "object" && "target" in e
                                ? e.target.value
                                : e
                            : null

                        const updatedVariant = cloneDeep(variant)
                        setKeyInVariant(valueKey, updatedVariant, val)
                        return updatedVariant
                    })
                },
                [variantId, config.valueKey, mutateVariant],
            )

            const getPropertyConfig = useCallback(() => {
                const configKey = config.configKey
                if (!configKey) {
                    throw new Error("Cannot get variant config without a configKey in the config")
                }
                const variant = swr.data?.variants.find((v) => v.variantId === variantId)
                const rawConfig = variant ? accessKeyInVariant(configKey, variant) : undefined
                return rawConfig && isSchemaObject(rawConfig) ? rawConfig : undefined
            }, [swr.data, config.configKey, variantId])

            const getVariantConfigProperty = useCallback(() => {
                const valueKey = config.valueKey
                if (!valueKey) {
                    throw new Error(
                        "Cannot get variant config property without a valueKey in the config",
                    )
                }

                const variant = swr.data?.variants.find((v) => v.variantId === variantId)
                const _config = getPropertyConfig()

                const valueInfo = variant
                    ? accessKeyInVariant(valueKey, cloneDeep(variant))
                    : undefined

                return {
                    property: _config
                        ? {
                              config: _config,
                              valueInfo,
                              handleChange: handleParamUpdate,
                          }
                        : undefined,
                }
            }, [swr.data, variantId, config.valueKey, handleParamUpdate])

            Object.defineProperty(swr, "variant", {
                get() {
                    checkInvalidSelector()
                    addToValueReferences("variant")
                    const variant = swr.data?.variants.find((v) => v.variantId === config.variantId)
                    return variant
                },
            })

            Object.defineProperty(swr, "variantConfig", {
                get() {
                    checkInvalidSelector()
                    addToValueReferences("variantConfig")
                    // return swr.data?.variants.find((v) => v.variantId === config.variantId)
                },
            })
            Object.defineProperty(swr, "variantConfigProperty", {
                get() {
                    checkInvalidSelector()
                    addToValueReferences("variantConfigProperty")
                    return getVariantConfigProperty()
                    // return swr.data?.variants.find((v) => v.variantId === config.variantId)
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
