import {useCallback} from "react"

import isEqual from "lodash/isEqual"

import usePlaygroundUtilities from "./hooks/usePlaygroundUtilities"

import type {Key, SWRHook} from "swr"
import type {FetcherOptions} from "@/lib/api/types"
import type {
    PlaygroundStateData,
    PlaygroundMiddleware,
    PlaygroundSWRConfig,
    PlaygroundMiddlewareParams,
    PlaygroundResponse,
    UIState,
    ViewType,
} from "../types"

const playgroundUIMiddleware: PlaygroundMiddleware = (useSWRNext: SWRHook) => {
    return <Data extends PlaygroundStateData = PlaygroundStateData, Selected = unknown>(
        key: Key,
        fetcher: ((url: string, options?: FetcherOptions) => Promise<Data>) | null,
        config: PlaygroundSWRConfig<Data, Selected>,
    ): PlaygroundResponse<Data, Selected> => {
        const useImplementation = ({
            key,
            fetcher,
            config,
        }: PlaygroundMiddlewareParams<Data>): UIState<Data, Selected> => {
            const {logger, valueReferences, addToValueReferences} = usePlaygroundUtilities({
                config: {
                    ...config,
                    name: "playgroundUIMiddleware",
                },
            })

            const swr = useSWRNext(key, fetcher, {
                ...config,
                revalidateOnMount:
                    config.revalidateOnMount ??
                    !(
                        valueReferences.current.includes("displayedVariants") ||
                        valueReferences.current.includes("viewType")
                    ),
                compare: useCallback(
                    (a?: Data, b?: Data) => {
                        const uiStateReferenced =
                            valueReferences.current.includes("displayedVariants") ||
                            valueReferences.current.includes("viewType")

                        logger(`COMPARE - ENTER`, uiStateReferenced)
                        const wrappedComparison = config.compare?.(a, b)

                        if (!uiStateReferenced) {
                            logger(`COMPARE - WRAPPED 1`, wrappedComparison)
                            return wrappedComparison
                        } else {
                            if (wrappedComparison) {
                                logger(
                                    `COMPARE - UI STATE REFERENCED - return wrapped`,
                                    wrappedComparison,
                                )
                                return true
                            } else {
                                const isViewTypeReferenced =
                                    valueReferences.current.includes("viewType")
                                const isDisplayedVariantsReferenced =
                                    valueReferences.current.includes("displayedVariants")

                                if (isDisplayedVariantsReferenced) {
                                    logger(
                                        `COMPARE - DISPLAYED VARIANTS REFERENCED - return COMPARISON`,
                                        wrappedComparison,
                                    )
                                    return isEqual(a?.selected, b?.selected)
                                } else if (isViewTypeReferenced) {
                                    logger(
                                        `COMPARE - VIEW TYPE REFERENCED - return COMPARISON`,
                                        wrappedComparison,
                                    )
                                    return a?.selected?.length === b?.selected?.length
                                }

                                return true
                            }
                        }
                    },
                    [config, logger],
                ),
            } as PlaygroundSWRConfig<Data>)

            const getDisplayedVariants = useCallback((): string[] => {
                addToValueReferences("displayedVariants")
                return swr.data?.selected || []
            }, [addToValueReferences, swr.data])

            const getViewType = useCallback((): ViewType => {
                addToValueReferences("viewType")
                return (swr.data?.selected?.length || 0) > 1 ? "comparison" : "single"
            }, [swr.data])

            const setSelectedDisplayVariant = useCallback(
                (variantId: string) => {
                    swr.mutate(
                        (state) => {
                            if (!state) return state
                            return {
                                ...state,
                                selected: [variantId],
                            }
                        },
                        {revalidate: false},
                    )
                },
                [swr],
            )

            const addVariantToDisplayList = useCallback(
                (variantId: string) => {
                    swr.mutate(
                        (state) => {
                            if (!state) return state
                            const newSelected = Array.from(new Set([...state.selected, variantId]))
                            return {
                                ...state,
                                selected: newSelected,
                            }
                        },
                        {revalidate: false},
                    )
                },
                [swr],
            )

            return Object.defineProperties(swr, {
                displayedVariants: {
                    get: getDisplayedVariants,
                    enumerable: true,
                },
                viewType: {
                    get: getViewType,
                    enumerable: true,
                },
                setSelectedVariant: {
                    get: () => {
                        addToValueReferences("setSelected")
                        return setSelectedDisplayVariant
                    },
                    enumerable: true,
                },
                addVariantToDisplay: {
                    get: () => {
                        addToValueReferences("addVariantToDisplay")
                        return addVariantToDisplayList
                    },
                    enumerable: true,
                },
            })
        }

        return useImplementation({key, fetcher, config})
    }
}

export default playgroundUIMiddleware
