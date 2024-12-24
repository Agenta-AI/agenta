import {useCallback} from "react"
import {Key, SWRHook} from "swr"
import {type FetcherOptions} from "@/lib/api/types"
import {
    PlaygroundStateData,
    PlaygroundMiddleware,
    PlaygroundSWRConfig,
    PlaygroundMiddlewareParams,
} from "../types"
import usePlaygroundUtilities from "./hooks/usePlaygroundUtilities"
import isEqual from "lodash/isEqual"

const selectorMiddleware: PlaygroundMiddleware = (useSWRNext: SWRHook) => {
    return <Data extends PlaygroundStateData = PlaygroundStateData>(
        key: Key,
        fetcher: ((url: string, options?: FetcherOptions) => Promise<Data>) | null,
        config: PlaygroundSWRConfig<Data>,
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
                                (v) => v.variantId === config.variantId,
                            )
                            const nextVariant = (b?.variants || []).find(
                                (v) => v.variantId === config.variantId,
                            )
                            prevSelected = prevVariant ? variantSelector(prevVariant) : undefined
                            nextSelected = nextVariant ? variantSelector(nextVariant) : undefined
                        } else if (stateSelector) {
                            prevSelected = a ? stateSelector(a) : undefined
                            nextSelected = b ? stateSelector(b) : undefined
                        }

                        const _isEqual = isEqual(prevSelected, nextSelected)
                        logger(`COMPARE - SELECTED`, _isEqual, prevSelected, nextSelected)
                        return _isEqual
                    },
                    [config, valueReferences],
                ),
            })

            const getSelectedData = useCallback(() => {
                addToValueReferences("selectedData")
                const {variantSelector, stateSelector} = config

                if (variantSelector && config.variantId && swr.data) {
                    const variant = swr.data.variants.find((v) => v.variantId === config.variantId)
                    return variant ? variantSelector(variant) : undefined
                }

                if (stateSelector && swr.data) {
                    return stateSelector(swr.data)
                }

                return undefined
            }, [swr.data, config])

            if (config.stateSelector || config.variantSelector) {
                const selectedData = getSelectedData() || {}
                const nativeKeys = new Set(Object.keys(swr))
                Object.keys(selectedData).forEach((key) => {
                    if (!nativeKeys.has(key)) {
                        Object.defineProperty(swr, key, {
                            get: () => selectedData[key],
                        })
                    }
                })
            }

            return swr
        }
        return useImplementation({key, fetcher, config})
    }
}

export default selectorMiddleware
