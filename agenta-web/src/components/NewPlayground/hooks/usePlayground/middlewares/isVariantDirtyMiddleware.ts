import {useCallback, useRef} from "react"

import usePlaygroundUtilities from "./hooks/usePlaygroundUtilities"

import {findPropertyInObject, isPlaygroundEqual, omitDeep} from "../assets/helpers"
import {initialState} from "../../../state"
import {syncVariantInputs} from "../assets/inputHelpers"
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
/**
 * Compare two variants ignoring specified properties
 */
const compareVariantsForDirtyState = (
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
                    const dirtyStates = {} as Record<string, boolean>

                    variants.forEach((variant) => {
                        dirtyStates[variant.id] = false
                    })

                    return {
                        ...data,
                        dataRef: new Map(variants.map((v) => [v.id, structuredClone(v)])),
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

                        const isDirtyReferenced = valueReferences.current.includes("isDirty")

                        if (!isDirtyReferenced) {
                            logger(`COMPARE - WRAPPED`, wrappedComparison, a, b)
                            return wrappedComparison
                        } else {
                            const isDirtyA = a?.dirtyStates?.[config.variantId ?? ""]
                            const isDirtyB = b?.dirtyStates?.[config.variantId ?? ""]

                            return isDirtyA === isDirtyB
                        }
                    },
                    [config, valueReferences, logger],
                ),
            } as PlaygroundSWRConfig<Data>)

            const originalMutateRef = useRef<SWRResponse<Data, Error>["mutate"]>(swr.mutate)

            const wrappedMutate = useCallback<KeyedMutator<Data>>(
                async (data, options) => {
                    const mutate = originalMutateRef.current

                    return mutate(
                        async (state) => {
                            const clonedState = structuredClone(state)
                            const variantId = config.variantId || options?.variantId

                            if (!clonedState || !state) return state

                            const dataRef = state.dataRef
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

                            const variant = clonedState.variants.find((v) => v.id === variantId)

                            if (
                                variant &&
                                !compareVariantsForDirtyState(dataRef?.get(variantId), variant)
                            ) {
                                const dirtyRef = state.dirtyStates
                                    ? structuredClone(state.dirtyStates)
                                    : {}
                                dirtyRef[variant.id] = true
                                clonedState.dirtyStates = dirtyRef
                            } else if (variant) {
                                const dirtyRef = state.dirtyStates
                                    ? structuredClone(state.dirtyStates)
                                    : {}
                                dirtyRef[variant.id] = false
                                clonedState.dirtyStates = dirtyRef
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

                            if (
                                !isPlaygroundEqual(currentSelected, previousSelected) &&
                                variant?.isChat
                            ) {
                                state.generationData.messages.value.forEach(
                                    (previousMessageRow) => {
                                        previousMessageRow.history.value.forEach(
                                            (previousMessage) => {
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
                                                        ...Object.keys(
                                                            previousMessage.__runs,
                                                        ).reduce((acc, key) => {
                                                            acc[currentSelected[0]] =
                                                                previousMessage.__runs[key]
                                                            return acc
                                                        }, {}),
                                                    }
                                                }
                                            },
                                        )
                                    },
                                )
                            }

                            return clonedState
                        },
                        {
                            revalidate: false,
                        },
                    )
                },
                [config.variantId],
            )

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
