import {useCallback} from "react"

import {findPropertyInObject, isPlaygroundEqual} from "../assets/helpers"

import usePlaygroundUtilities from "./hooks/usePlaygroundUtilities"

import type {FetcherOptions} from "@/lib/api/types"
import type {Key, SWRHook} from "swr"
import type {
    PlaygroundStateData,
    PlaygroundMiddleware,
    PlaygroundSWRConfig,
    PlaygroundMiddlewareParams,
} from "../types"

const selectorMiddleware: PlaygroundMiddleware = <
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
            const {logger, valueReferences, addToValueReferences} = usePlaygroundUtilities({
                config: {
                    ...config,
                    name: "selectorMiddleware",
                },
            })

            const swr = useSWRNext(key, fetcher, {
                ...config,
                compare: useCallback(
                    (a?: Data, b?: Data) => {
                        const selectorReferenced = valueReferences.current.includes("selectedData")
                        logger(`COMPARE - ENTER`, selectorReferenced)

                        if (!selectorReferenced) {
                            const wrappedComparison = config.compare?.(a, b)
                            logger(`COMPARE - WRAPPED`, wrappedComparison)
                            return wrappedComparison ?? true
                        }

                        const {variantSelector, stateSelector} = config
                        let prevSelected, nextSelected

                        if (variantSelector && config.variantId) {
                            const prevVariant = (a?.variants || []).find(
                                (v) => v.id === config.variantId,
                            )
                            const nextVariant = (b?.variants || []).find(
                                (v) => v.id === config.variantId,
                            )
                            prevSelected = prevVariant ? variantSelector(prevVariant) : undefined
                            nextSelected = nextVariant ? variantSelector(nextVariant) : undefined
                        } else if (stateSelector) {
                            prevSelected = a ? stateSelector(a) : undefined
                            nextSelected = b ? stateSelector(b) : undefined
                        }

                        const _isEqual = isPlaygroundEqual(prevSelected, nextSelected)
                        logger(`COMPARE - SELECTED`, _isEqual, prevSelected, nextSelected)
                        return _isEqual
                    },
                    [config, logger, valueReferences],
                ),
            })

            const getSelectedData = useCallback(() => {
                addToValueReferences("selectedData")
                const {variantSelector, stateSelector} = config

                if (variantSelector && config.variantId && swr.data) {
                    const variant = swr.data.variants.find((v) => v.id === config.variantId)
                    return variant ? variantSelector(variant) : undefined
                }

                if (stateSelector && swr.data) {
                    return stateSelector(swr.data)
                }

                return undefined
            }, [addToValueReferences, config, swr.data])

            if (config.stateSelector || config.variantSelector) {
                const selectedData = getSelectedData()
                if (selectedData) {
                    // Spread selected data into SWR response
                    Object.entries(selectedData).forEach(([key, value]) => {
                        if (!(key in swr)) {
                            Object.defineProperty(swr, key, {
                                enumerable: true,
                                get() {
                                    addToValueReferences("selectedData")
                                    return value
                                },
                            })
                        }
                    })
                }
            }

            Object.defineProperty(swr, "propertyGetter", {
                get: () => {
                    return (propertyId: string) => {
                        return findPropertyInObject(swr.data, propertyId)
                    }
                },
            })

            return swr
        }
        return useImplementation({key, fetcher, config})
    }
}

export default selectorMiddleware
