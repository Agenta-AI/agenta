// @ts-nocheck
import {useCallback} from "react"

import isEqual from "lodash/isEqual"
import {type Key, type SWRHook, useSWRConfig} from "swr"

import {findCustomWorkflowPath} from "@/oss/components/NewPlayground/hooks/usePlayground/assets/helpers"
import {type FetcherOptions} from "@/oss/lib/api/types"
import {type Variant} from "@/oss/lib/Types"

import {type OpenAPISpec} from "../assets/genericTransformer/types"
import {toSnakeCase} from "../assets/genericTransformer/utilities/string"
import {fetchOpenApiSchemaJson, setVariants, transformVariants} from "../assets/helpers"
import {initialState, specAtom, atomStore, getMetadataLazy} from "../state"
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
            const openApiSchemaFetcher = useCallback(
                async (url: string, options?: FetcherOptions): Promise<Data> => {
                    const cache = config.cache || new Map()
                    if (!url || !globalFetcher) {
                        return initialState as Data
                    }
                    const cachedValue = cache.get(url)?.data

                    const state = structuredClone(cachedValue || initialState) as Data

                    if (!fetcher) {
                        return state
                    }

                    try {
                        const [variants] = config.initialVariants?.length
                            ? [config.initialVariants]
                            : await Promise.all([globalFetcher(url, options) as Promise<Variant[]>])

                        state.uri =
                            variants[0]?.uriObject ||
                            (await findCustomWorkflowPath(variants[0]?.uri))

                        if (!state.uri) {
                            throw new Error("No uri found for the new app type")
                        }

                        variants.forEach((variant) => {
                            variant.uriObject = state.uri
                        })

                        const specResponse = await fetchOpenApiSchemaJson(state.uri.runtimePrefix)
                        const spec = state.spec || (specResponse.schema as OpenAPISpec)

                        if (!spec) {
                            return state
                        }

                        state.variants = setVariants(state.variants, variants, state.uri)

                        state.variants = transformVariants(
                            state.variants,
                            spec,
                            config.appType,
                        ).map((variant) => {
                            return {
                                ...variant,
                                variant: variant,
                                promptOptParams: variant.prompts.reduce((acc, prompt) => {
                                    Object.keys(prompt.llmConfig).map((key) => {
                                        if (["__id", "__metadata"].includes(key)) {
                                            return acc
                                        }
                                        // const originalParam = prompt.llmConfig[key]

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
            })
        }
        return useImplementation({key, fetcher, config})
    }
}

export default appSchemaMiddleware
