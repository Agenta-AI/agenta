import {useCallback} from "react"

import {type Key, type SWRHook, useSWRConfig} from "swr"

import {fetchOpenApiSchemaJson, setVariants, transformVariants} from "../assets/helpers"
// import usePlaygroundUtilities from "./hooks/usePlaygroundUtilities"
import {initialState, specAtom, atomStore, getMetadataLazy} from "../state"

import {type FetcherOptions} from "@/lib/api/types"
import {type Variant} from "@/lib/Types"
import {type OpenAPISpec} from "../assets/genericTransformer/types"
import type {
    PlaygroundStateData,
    PlaygroundMiddleware,
    PlaygroundMiddlewareParams,
    PlaygroundSWRConfig,
} from "../types"
import isEqual from "lodash/isEqual"
import {toSnakeCase} from "../assets/genericTransformer/utilities/string"

const appSchemaMiddleware: PlaygroundMiddleware = (useSWRNext: SWRHook) => {
    return <Data extends PlaygroundStateData = PlaygroundStateData>(
        key: Key,
        fetcher: ((url: string, options?: FetcherOptions) => Promise<Data>) | null,
        config: PlaygroundSWRConfig<Data>,
    ) => {
        const {fetcher: globalFetcher} = useSWRConfig()
        const useImplementation = ({key, fetcher, config}: PlaygroundMiddlewareParams<Data>) => {
            const openApiSchemaFetcher = useCallback(
                async (url: string, options?: FetcherOptions): Promise<Data> => {
                    const cache = config.cache || new Map()
                    if (!url || !globalFetcher) {
                        return initialState as Data
                    }
                    const cachedValue = cache.get(url)?.data

                    if (cachedValue) {
                        if (
                            !config.initialVariants ||
                            (!!config.initialVariants &&
                                isEqual(
                                    cachedValue.variants.map((v) => v.id),
                                    config.initialVariants.map((v) => v.id),
                                ))
                        ) {
                            return cachedValue
                        }
                    }

                    let state = structuredClone(cachedValue || initialState) as Data

                    if (!fetcher) {
                        return state
                    }

                    try {
                        const [variants] = config.initialVariants?.length
                            ? [config.initialVariants]
                            : await Promise.all([globalFetcher(url, options) as Promise<Variant[]>])

                        const uri = variants[0].uri

                        if (!uri) {
                            throw new Error("No uri found for the new app type")
                        }

                        const specResponse = await fetchOpenApiSchemaJson(uri)
                        // write(specResponse.schema)
                        const spec = state.spec || (specResponse.schema as OpenAPISpec)

                        if (!spec) {
                            throw new Error("No spec found")
                        }

                        state.variants = transformVariants(
                            setVariants(state.variants, variants),
                            spec,
                        ).map((variant) => {
                            return {
                                ...variant,
                                variant: variant,
                                promptOptParams: variant.prompts.reduce((acc, prompt) => {
                                    Object.keys(prompt.llmConfig).map((key) => {
                                        if (["__id", "__metadata"].includes(key)) {
                                            return acc
                                        }
                                        const originalParam = prompt.llmConfig[key]

                                        const param = {
                                            ...prompt.llmConfig[key],
                                            name: toSnakeCase(key),
                                            ...getMetadataLazy(prompt.llmConfig[key].__metadata),
                                        }
                                        delete param.__metadata
                                        delete param.__id
                                        acc.push(param)
                                    })
                                    return acc
                                }, []),
                            }
                        })
                        atomStore.set(specAtom, () => spec)

                        return state
                    } catch (error) {
                        console.error("Error in openApiSchemaFetcher:", error)
                        return state
                    }
                },
                [config.cache, config.initialVariants, fetcher],
            )

            return useSWRNext(key, openApiSchemaFetcher, {
                ...config,
                compare: (a, b) => {
                    return isEqual(a, b)
                },
                revalidateOnFocus: false,
                revalidateOnReconnect: false,
            })
        }
        return useImplementation({key, fetcher, config})
    }
}

export default appSchemaMiddleware
