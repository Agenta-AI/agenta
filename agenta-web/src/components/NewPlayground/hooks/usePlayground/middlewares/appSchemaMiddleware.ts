import {useCallback} from "react"

import {type Key, type SWRHook, useSWRConfig} from "swr"

import {fetchOpenApiSchemaJson, setVariants, transformVariants} from "../assets/helpers"
import usePlaygroundUtilities from "./hooks/usePlaygroundUtilities"
import {initialState, specAtom, atomStore} from "../../../state"

import {type FetcherOptions} from "@/lib/api/types"
import {type Variant} from "@/lib/Types"
import {type OpenAPISpec} from "../../../assets/utilities/genericTransformer/types"
import type {
    PlaygroundStateData,
    PlaygroundMiddleware,
    PlaygroundMiddlewareParams,
    PlaygroundSWRConfig,
} from "../types"
import {initializeGenerationInputs, initializeGenerationMessages} from "../assets/generationHelpers"
import {detectChatVariantFromOpenAISchema} from "@/components/NewPlayground/assets/utilities/genericTransformer"

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

                    logger(`FETCH - ENTER`)

                    if (cachedValue && !cachedValue.error) {
                        logger(`FETCH - RETURN CACHE AND DO NOT REFETCH`, cachedValue)
                        return cachedValue
                    }

                    let state = structuredClone(cachedValue || initialState) as Data

                    if (!fetcher) {
                        return state
                    }

                    logger(`FETCH - FETCH`)

                    try {
                        const [variants] = await Promise.all([
                            globalFetcher(url, options) as Promise<Variant[]>,
                        ])
                        const uri = variants[0].uri

                        if (!uri) {
                            throw new Error("No uri found for the new app type")
                        }

                        try {
                            const specResponse = await fetchOpenApiSchemaJson(uri)
                            const spec = state.spec || (specResponse.schema as OpenAPISpec)

                            if (!spec) {
                                throw new Error("No spec found")
                            }

                            state.variants = transformVariants(
                                setVariants(state.variants, variants),
                                spec,
                            )

                            atomStore.set(specAtom, () => spec)

                            state.selected = [state.variants[0].id]

                            state.generationData.inputs = initializeGenerationInputs(
                                state.variants.filter((v) => state.selected.includes(v.id)),
                            )

                            // initializeVariantInputs(enhancedVariant)
                            if (detectChatVariantFromOpenAISchema(spec)) {
                                state.generationData.messages = initializeGenerationMessages(
                                    state.variants,
                                )
                            }

                            state.error = undefined
                            return state
                        } catch (err) {
                            throw new Error("Error fetching spec")
                        }
                    } catch (err) {
                        console.error("Error in openApiSchemaFetcher:", err)
                        state.error = err
                        return state
                    }
                },
                [config.cache, fetcher, logger],
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
