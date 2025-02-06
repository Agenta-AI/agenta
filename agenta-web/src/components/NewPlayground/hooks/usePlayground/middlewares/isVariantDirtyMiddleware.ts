import {useCallback, useRef} from "react"
import dayjs from "dayjs"
import usePlaygroundUtilities from "./hooks/usePlaygroundUtilities"

import {findPropertyInObject, findVariantById, isPlaygroundEqual, omitDeep} from "../assets/helpers"
import {getMetadataLazy, getVariantsLazy, initialState} from "../../../state"
import {syncVariantInputs, updateVariantPromptKeys} from "../assets/inputHelpers"
import {getUniqueInputKeys} from "../assets/generationHelpers"

import type {Key, KeyedMutator, SWRResponse, SWRHook} from "swr"
import {type FetcherOptions} from "@/lib/api/types"
import type {
    PlaygroundStateData,
    PlaygroundMiddleware,
    PlaygroundSWRConfig,
    PlaygroundMiddlewareParams,
} from "../types"
import type {EnhancedVariant} from "../../../assets/utilities/transformer/types"
import {createMessageFromSchema} from "../assets/messageHelpers"
import {hashVariant} from "@/components/NewPlayground/assets/hash"
/**
 * Compare two variants ignoring specified properties
 */
export const compareVariantsForDirtyState = (
    variant1: EnhancedVariant | undefined,
    variant2: EnhancedVariant | undefined,
    ignoreKeys: string[] = ["inputs", "__isMutating"],
): boolean => {
    if (!variant1 || !variant2) return variant1 === variant2

    // Create clean copies without ignored properties
    const cleanVariant1 = omitDeep(variant1, ignoreKeys)
    const cleanVariant2 = omitDeep(variant2, ignoreKeys)

    return isPlaygroundEqual(cleanVariant1, cleanVariant2)
}

type MutateFunction<T extends PlaygroundStateData = PlaygroundStateData> = (
    state: T | Promise<T> | undefined,
) => T | Promise<T>

const isVariantDirtyMiddleware: PlaygroundMiddleware = (useSWRNext: SWRHook) => {
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
                        name: "isVariantDirtyMiddleware",
                    },
                })

            const fetcherWithIsDirty = useCallback(
                async (url: string, options?: FetcherOptions): Promise<Data> => {
                    const data = await fetcher?.(url, options)

                    if (!data) return initialState as Data

                    const variants = data.variants || []
                    const dirtyStates = data.dirtyStates || ({} as Record<string, boolean>)

                    const dataRef = variants.reduce(
                        (acc, variant) => {
                            const existingRef = data.dataRef?.[variant.id]
                            const variantHash = hashVariant(variant)
                            if (
                                !existingRef ||
                                dayjs(variant.updatedAt).isAfter(dayjs(existingRef?.updatedAt))
                            ) {
                                acc[variant.id] = variantHash
                                // structuredClone(variant)
                            } else {
                                acc[variant.id] = existingRef
                            }

                            if (acc[variant.id] && variant && variantHash !== acc[variant.id]) {
                                const newVariant = getVariantsLazy(variantHash)
                                const previousVariant = getVariantsLazy(acc[variant.id])
                                dirtyStates[variant.id] = !compareVariantsForDirtyState(
                                    previousVariant,
                                    newVariant,
                                )
                            }
                            return acc
                        },
                        data?.dataRef || ({} as Record<string, EnhancedVariant>),
                    )

                    return {
                        ...data,
                        dataRef,
                        dirtyStates,
                        variants,
                    }
                },
                [fetcher],
            )

            const swr = useSWRNext(key, fetcherWithIsDirty, {
                ...config,
                revalidateOnFocus: false,
                revalidateOnReconnect: false,
                compare: useCallback(
                    (a?: Data, b?: Data) => {
                        const wrappedComparison = config.compare?.(a, b)
                        return wrappedComparison
                    },
                    [config],
                ),
            } as PlaygroundSWRConfig<Data>)

            const originalMutateRef = useRef<SWRResponse<Data, Error>["mutate"]>(swr.mutate)

            const wrappedMutate = useCallback<KeyedMutator<Data>>(async (data, options) => {
                const mutate = originalMutateRef.current

                return mutate(
                    async (state) => {
                        const clonedState = structuredClone(state)

                        if (!clonedState || !state) return state

                        let newState: Data

                        if (typeof data === "function") {
                            const updateFn = data as MutateFunction<Data>
                            const result = await updateFn(clonedState)
                            newState = result ?? clonedState
                        } else if (data !== undefined) {
                            // Handle partial state update
                            for (const key in data) {
                                clonedState[key] = data[key]
                            }
                        }

                        /**
                         * before committing changes to the state check if we need to
                         * sync the generation data in line with new state variants
                         *
                         * conditions:
                         * - selected [visible] variants have changed -> different variants may have different inputs
                         * - an updated [displayed] variant have new / removed inputs
                         */
                        const previousSelected = [...state.selected]
                        const currentSelected = clonedState.selected

                        const previousInputs = getUniqueInputKeys(
                            state.variants.filter((variant) =>
                                previousSelected.includes(variant.id),
                            ),
                        )
                        for (const variantId of clonedState.selected) {
                            const _variant = findVariantById(clonedState, variantId)
                            updateVariantPromptKeys(_variant)
                        }
                        const currentInputs = getUniqueInputKeys(
                            clonedState.variants.filter((variant) =>
                                currentSelected.includes(variant.id),
                            ),
                        )

                        if (!isPlaygroundEqual(previousInputs, currentInputs)) {
                            clonedState.generationData.inputs = syncVariantInputs(
                                clonedState.variants.filter((variant) =>
                                    currentSelected.includes(variant.id),
                                ),
                                clonedState.generationData.inputs,
                            )
                        }

                        const isChat = clonedState.variants.some((v) => v.isChat)

                        if (
                            !isPlaygroundEqual(
                                state.generationData.messages,
                                clonedState.generationData.messages,
                            ) &&
                            isChat
                        ) {
                            clonedState.generationData?.messages.value.forEach((messageRow) => {
                                const history = messageRow.history.value
                                if (!history.length) {
                                    const emptyMessage = createMessageFromSchema(
                                        getMetadataLazy(
                                            clonedState.variants[0].prompts[0].messages.__metadata,
                                        ).itemMetadata,
                                        {
                                            role: "user",
                                        },
                                    )
                                    messageRow.history.value.push(emptyMessage)
                                }
                            })
                        }

                        if (!isPlaygroundEqual(currentSelected, previousSelected) && isChat) {
                            state.generationData.messages.value.forEach((previousMessageRow) => {
                                previousMessageRow.history.value.forEach((previousMessage) => {
                                    if (
                                        previousMessage.__runs &&
                                        Object.keys(previousMessage.__runs).length > 0
                                    ) {
                                        const currentMessage = findPropertyInObject(
                                            clonedState.generationData.messages.value,
                                            previousMessage.__id,
                                        )
                                        currentMessage.__runs = {
                                            ...previousMessage.__runs,
                                            ...Object.keys(previousMessage.__runs).reduce(
                                                (acc, key) => {
                                                    acc[currentSelected[0]] =
                                                        previousMessage.__runs[key]
                                                    return acc
                                                },
                                                {},
                                            ),
                                        }
                                    }
                                })
                            })
                        }

                        if (clonedState?.dirtyStates) {
                            const dirtyStates =
                                clonedState.dirtyStates || ({} as Record<string, boolean>)

                            const dataRef = clonedState.variants.reduce(
                                (acc, variant) => {
                                    const existingRef = clonedState.dataRef?.[variant.id]
                                    const variantHash = hashVariant(variant)

                                    if (variantHash !== existingRef) {
                                        const existingVariant = getVariantsLazy(existingRef)
                                        const newVariant = getVariantsLazy(variantHash)
                                        if (
                                            !existingRef ||
                                            dayjs(variant.updatedAt).isAfter(
                                                dayjs(existingRef?.updatedAt),
                                            ) ||
                                            variant.revision > existingRef.revision
                                        ) {
                                            acc[variant.id] = variantHash
                                        } else {
                                            acc[variant.id] = existingRef
                                        }

                                        dirtyStates[variant.id] = !compareVariantsForDirtyState(
                                            existingVariant,
                                            newVariant,
                                        )
                                    } else {
                                        dirtyStates[variant.id] = false
                                    }
                                    return acc
                                },
                                clonedState?.dataRef || ({} as Record<string, EnhancedVariant>),
                            )

                            clonedState.dataRef = dataRef
                        }

                        return clonedState
                    },
                    {
                        revalidate: options?.revalidate || false,
                    },
                )
            }, [])

            Object.defineProperty(swr, "mutate", {
                get: () => {
                    return wrappedMutate
                },
            })

            return swr
        }
        return useImplementation({key, fetcher, config})
    }
}

export default isVariantDirtyMiddleware
