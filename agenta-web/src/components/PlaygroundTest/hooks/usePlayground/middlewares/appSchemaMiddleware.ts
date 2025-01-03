import {Key, SWRHook, useSWRConfig} from "swr"
import {type FetcherOptions} from "@/lib/api/types"
import {
    PlaygroundStateData,
    PlaygroundMiddleware,
    PlaygroundMiddlewareParams,
    PlaygroundSWRConfig,
} from "../types"
import {useCallback} from "react"
import cloneDeep from "lodash/cloneDeep"
import {fetchAndUpdateVariants, fetchOpenApiSchemaJson, setVariants} from "../assets/helpers"
import usePlaygroundUtilities from "./hooks/usePlaygroundUtilities"
import {initialState} from "@/components/PlaygroundTest/state"
import {Variant} from "@/lib/Types"

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

            const openApiSchemaFetcher = async (
                url: string,
                options?: FetcherOptions,
            ): Promise<Data> => {
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
                    const [variants, specResponse] = await Promise.all([
                        globalFetcher(url, options) as Promise<Variant[]>,
                        ...(!state.spec ? [fetchOpenApiSchemaJson(config.service)] : []),
                    ])
                    const spec = state.spec || specResponse.schema

                    console.log("variants", variants)
                    state.variants = await fetchAndUpdateVariants(
                        setVariants(state.variants, variants),
                        spec,
                    )
                    state.spec = specResponse.schema

                    return state
                } catch (error) {
                    console.error("Error in openApiSchemaFetcher:", error)
                    return state
                }
            }

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
                    [config],
                ),
            })
        }
        return useImplementation({key, fetcher, config})
    }
}

export default appSchemaMiddleware
