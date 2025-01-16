import {useCallback, useRef} from "react"

import usePlaygroundUtilities from "./hooks/usePlaygroundUtilities"

import {initialState} from "../../../state"
import {isPlaygroundEqual, omitDeep} from "../assets/helpers"

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

            const dirtyRef = useRef(new Map<string, boolean>())

            const fetcherWithIsDirty = useCallback(
                async (url: string, options?: FetcherOptions): Promise<Data> => {
                    const data = await fetcher?.(url, options)

                    if (!data) return initialState as Data

                    const variants = data.variants || []
                    const dirtyStates = new Map<string, boolean>()

                    variants.forEach((variant) => {
                        dirtyStates.set(variant.id, false)
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
                            const isDirtyA = a?.dirtyStates?.get(config.variantId ?? "")
                            const isDirtyB = b?.dirtyStates?.get(config.variantId ?? "")

                            return isDirtyA === isDirtyB
                        }
                    },
                    [config, valueReferences, logger],
                ),
            } as PlaygroundSWRConfig<Data>)

            const originalMutateRef = useRef<SWRResponse<Data, Error>["mutate"]>(swr.mutate)

            const setIsDirty = useCallback(
                (variantId: string, isDirty: boolean) => {
                    dirtyRef.current.set(variantId, isDirty)
                    swr.mutate(
                        (currentData) => {
                            if (!currentData) return currentData
                            return {
                                ...currentData,
                                dirtyStates: new Map(dirtyRef.current),
                            }
                        },
                        {revalidate: false},
                    )
                },
                [swr],
            )

            const wrappedMutate = useCallback<KeyedMutator<Data>>(
                async (data) => {
                    const mutate = originalMutateRef.current

                    return mutate(
                        async (state) => {
                            const clonedState = structuredClone(state)

                            if (!clonedState || !state) return state

                            const dataRef = clonedState.dataRef
                            let newState: Data

                            if (typeof data === "function") {
                                const updateFn = data as MutateFunction<Data>
                                const result = await updateFn(clonedState)
                                newState = result ?? clonedState
                            } else if (data !== undefined) {
                                // Handle partial state update
                                newState = {
                                    ...clonedState,
                                    ...(data as Partial<Data>),
                                }
                            } else {
                                newState = clonedState
                            }

                            const variant = newState.variants.find((v) => v.id === config.variantId)

                            if (
                                variant &&
                                !compareVariantsForDirtyState(
                                    dataRef?.get(config.variantId),
                                    variant,
                                )
                            ) {
                                const dirtyRef = clonedState.dirtyStates
                                    ? new Map(clonedState.dirtyStates)
                                    : new Map()
                                dirtyRef.set(variant.id, true)
                                clonedState.dirtyStates = dirtyRef
                            } else if (variant) {
                                const dirtyRef = clonedState.dirtyStates
                                    ? new Map(clonedState.dirtyStates)
                                    : new Map()
                                dirtyRef.set(variant.id, false)
                                clonedState.dirtyStates = dirtyRef
                            }

                            return newState
                        },
                        {
                            revalidate: false,
                        },
                    )
                },
                [config.variantId, logger],
            )

            const getSetIsDirty = useCallback(() => {
                checkInvalidSelector()
                addToValueReferences("setIsDirty")
                return setIsDirty
            }, [setIsDirty, checkInvalidSelector, addToValueReferences])

            Object.defineProperty(swr, "mutate", {
                get: () => {
                    return wrappedMutate
                },
            })

            Object.defineProperty(swr, "setIsDirty", {
                get: getSetIsDirty,
            })
            Object.defineProperty(swr, "isDirty", {
                get: () => {
                    addToValueReferences("isDirty")
                    return config.variantId
                        ? swr.data?.dirtyStates?.get?.(config.variantId)
                        : undefined
                },
            })

            return swr
        }
        return useImplementation({key, fetcher, config})
    }
}

export default isVariantDirtyMiddleware
