import {useCallback} from "react"

import {type Key, type SWRHook, useSWRConfig} from "swr"

import {detectChatVariantFromOpenAISchema} from "@/oss/components/NewPlayground/assets/utilities/genericTransformer"
import {DEFAULT_UUID} from "@/oss/contexts/project.context"
import {type FetcherOptions} from "@/oss/lib/api/types"
import {type Variant} from "@/oss/lib/Types"

import {type OpenAPISpec} from "../../../assets/utilities/genericTransformer/types"
import {initialState, specAtom, atomStore} from "../../../state"
import {initializeGenerationInputs, initializeGenerationMessages} from "../assets/generationHelpers"
import {
    fetchOpenApiSchemaJson,
    findCustomWorkflowPath,
    setVariants,
    transformVariants,
} from "../assets/helpers"
import type {
    PlaygroundStateData,
    PlaygroundMiddleware,
    PlaygroundMiddlewareParams,
    PlaygroundSWRConfig,
    PlaygroundResponse,
} from "../types"

import usePlaygroundUtilities from "./hooks/usePlaygroundUtilities"

const appSchemaMiddleware: PlaygroundMiddleware = (useSWRNext: SWRHook) => {
    return <Data extends PlaygroundStateData = PlaygroundStateData, Selected = unknown>(
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

                    const state = structuredClone(cachedValue || initialState) as Data

                    if (!fetcher) {
                        return state
                    }

                    logger(`FETCH - FETCH`)

                    try {
                        const [variants] = await Promise.all([
                            globalFetcher(url, options) as Promise<Variant[]>,
                        ])

                        if (!variants[0].uri) {
                            return state
                        }

                        const specPath = await findCustomWorkflowPath(variants[0].uri)

                        state.uri = specPath

                        if (state.uri?.routePath === undefined) {
                            throw new Error("No uri found for the new app type")
                        }

                        try {
                            const specResponse = await fetchOpenApiSchemaJson(
                                state.uri.runtimePrefix,
                            )
                            const spec = state.spec || (specResponse.schema as OpenAPISpec)

                            if (!spec) {
                                throw new Error(
                                    specResponse?.errors?.detail ||
                                        specResponse?.errors?.message ||
                                        "No spec found",
                                )
                            }

                            state.variants = transformVariants(
                                setVariants(state.variants, variants),
                                spec,
                                config.appType,
                                state.uri.routePath,
                            )

                            atomStore.set(specAtom, () => spec)

                            state.selected = [state.variants[0].id]

                            state.generationData.inputs = initializeGenerationInputs(
                                state.variants.filter((v) => state.selected.includes(v.id)),
                                spec,
                                state.uri.routePath,
                            )

                            if (detectChatVariantFromOpenAISchema(spec, state.uri)) {
                                state.generationData.messages = initializeGenerationMessages(
                                    state.variants,
                                )
                            }

                            state.error = undefined
                            return state
                        } catch (err) {
                            state.error = err as Error
                            return state
                        }
                    } catch (err) {
                        console.error("Error in openApiSchemaFetcher:", err)
                        state.error = err as Error
                        return state
                    }
                },
                [config.cache, fetcher, logger],
            )

            return useSWRNext(
                key,
                !config.projectId || config.projectId === DEFAULT_UUID
                    ? null
                    : openApiSchemaFetcher,
                {
                    ...config,
                    revalidateOnFocus: true,
                    revalidateOnReconnect: true,
                    revalidateIfStale: true,
                    revalidateOnMount: true,
                    compare: useCallback(
                        (a?: Data, b?: Data) => {
                            const wrappedComparison = config.compare?.(a, b)
                            logger(`COMPARE - ENTER`, wrappedComparison, a, b)
                            return wrappedComparison ?? true
                        },
                        [config, logger],
                    ),
                },
            ) as PlaygroundResponse<Data, Selected>
        }
        return useImplementation({key, fetcher, config})
    }
}

export default appSchemaMiddleware
