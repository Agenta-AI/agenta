import {useCallback} from "react"

import {type Key, type SWRHook, useSWRConfig} from "swr"
import cloneDeep from "lodash/cloneDeep"

import {fetchOpenApiSchemaJson, setVariants, transformVariants} from "../assets/helpers"
import usePlaygroundUtilities from "./hooks/usePlaygroundUtilities"
import {initialState} from "../../../state"

import {type FetcherOptions} from "@/lib/api/types"
import {type Variant} from "@/lib/Types"
import {type OpenAPISpec} from "../../../assets/utilities/genericTransformer/types"
import type {
    PlaygroundStateData,
    PlaygroundMiddleware,
    PlaygroundMiddlewareParams,
    PlaygroundSWRConfig,
} from "../types"

const appSchemaMiddleware: PlaygroundMiddleware = (useSWRNext: SWRHook) => {
    return <Data extends PlaygroundStateData = PlaygroundStateData>(
        key: Key,
        fetcher: ((url: string, options?: FetcherOptions) => Promise<Data>) | null,
        config: PlaygroundSWRConfig<Data>,
    ) => {
        const {fetcher: globalFetcher} = useSWRConfig()
        const useImplementation = ({key, fetcher, config}: PlaygroundMiddlewareParams<Data>) => {
            const {logger} = usePlaygroundUtilities({
                config: {
                    ...config,
                    name: "appSchemaMiddleware",
                },
            })

            const openApiSchemaFetcher = useCallback(
                async (url: string, options?: FetcherOptions): Promise<Data> => {
                    const cache = config.cache || new Map()
                    if (!url || !globalFetcher) {
                        return initialState as Data
                    }
                    const cachedValue = cache.get(url)?.data
                    if (!config.service) {
                        return cachedValue || (initialState as Data)
                    }

                    logger(`FETCH - ENTER`)

                    if (cachedValue) {
                        logger(`FETCH - RETURN CACHE AND DO NOT REFETCH`, cachedValue)
                        return cachedValue
                    }

                    let state = cloneDeep(cachedValue || initialState) as Data

                    if (!fetcher) {
                        return state
                    }

                    logger(`FETCH - FETCH`)

                    try {
                        const [variants] = await Promise.all([
                            globalFetcher(url, options) as Promise<Variant[]>,
                        ])
                        const uri = variants[0].uri
                        const specResponse = await fetchOpenApiSchemaJson(uri)
                        const spec = state.spec || (specResponse.schema as OpenAPISpec)

                        if (!spec) {
                            throw new Error("No spec found")
                        }

                        state.variants = transformVariants(
                            setVariants(state.variants, variants),
                            spec,
                        )
                        state.spec = spec
                        state.selected = [state.variants[0].id]

                        return state
                    } catch (error) {
                        console.error("Error in openApiSchemaFetcher:", error)
                        return state
                    }
                },
                [config.cache, config.service, fetcher, logger],
            )

            return useSWRNext(key, openApiSchemaFetcher, {
                ...config,
                revalidateOnFocus: false,
                revalidateOnReconnect: false,
                revalidateIfStale: false,
                revalidateOnMount: config.revalidateOnMount ?? true,
                compare: useCallback(
                    (a?: Data, b?: Data) => {
                        const wrappedComparison = config.compare?.(a, b)
                        logger(`COMPARE - ENTER`, wrappedComparison, a, b)
                        return wrappedComparison ?? true
                    },
                    [config, logger],
                ),
            })
        }
        return useImplementation({key, fetcher, config})
    }
}

export default appSchemaMiddleware
