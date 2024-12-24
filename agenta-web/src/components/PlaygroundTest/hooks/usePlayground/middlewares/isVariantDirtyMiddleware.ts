import {useCallback, useRef} from "react"
import {Key, KeyedMutator, SWRResponse, SWRHook} from "swr"
import {type FetcherOptions} from "@/lib/api/types"
import {
    PlaygroundStateData,
    PlaygroundMiddleware,
    PlaygroundSWRConfig,
    PlaygroundMiddlewareParams,
} from "../types"
import isEqual from "lodash/isEqual"
import usePlaygroundUtilities from "./hooks/usePlaygroundUtilities"
import cloneDeep from "lodash/cloneDeep"
import {initialState} from "../assets/constants"

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
                        dirtyStates.set(variant.variantId, false)
                    })

                    return {
                        ...data,
                        dataRef: new Map(variants.map((v) => [v.variantId, cloneDeep(v)])),
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
                    [valueReferences, config],
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
                [swr.mutate],
            )

            const wrappedMutate = useCallback<KeyedMutator<Data>>(
                async (data) => {
                    const mutate = originalMutateRef.current

                    return mutate(
                        async (state) => {
                            if (!state) return state

                            let newState: Data
                            if (typeof data === "function") {
                                const updateFn = data as MutateFunction<Data>
                                const result = await updateFn(cloneDeep(state))
                                newState = result ?? state
                            } else if (data !== undefined) {
                                // Handle partial state update
                                newState = {
                                    ...state,
                                    ...(data as Partial<Data>),
                                }
                            } else {
                                newState = state
                            }

                            const clonedState = cloneDeep(newState)
                            const dataRef = clonedState.dataRef
                            const variant = newState.variants.find(
                                (v) => v.variantId === config.variantId,
                            )

                            if (variant && !isEqual(dataRef?.get(config.variantId), variant)) {
                                const dirtyRef = clonedState.dirtyStates
                                    ? new Map(clonedState.dirtyStates)
                                    : new Map()
                                dirtyRef.set(variant.variantId, true)
                                clonedState.dirtyStates = dirtyRef
                            } else if (variant) {
                                const dirtyRef = clonedState.dirtyStates
                                    ? new Map(clonedState.dirtyStates)
                                    : new Map()
                                dirtyRef.set(variant.variantId, false)
                                clonedState.dirtyStates = dirtyRef
                            }

                            logger("WRAPPED MUTATE", state, clonedState)
                            return clonedState
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
            }, [swr, setIsDirty, checkInvalidSelector, addToValueReferences])

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
