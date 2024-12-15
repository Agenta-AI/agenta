import {useCallback, useMemo} from "react"

import useSWR, {
    SWRResponse,
    SWRConfiguration,
    Key,
    useSWRConfig,
    BareFetcher,
    Middleware,
} from "swr"
import Router from "next/router"
import {getCurrentProject} from "@/contexts/project.context"
import isEqual from "lodash/isEqual"
import type {InitialStateType, OpenAPISchema, StateVariant} from "../../state/types"
import type {UsePlaygroundStateOptions} from "../usePlaygroundState/types"
import {openAPIJsonFetcher} from "./assets/fetchers"
import cloneDeep from "lodash/cloneDeep"
import {initialState} from "./assets/constants"

const usePlaygroundState = ({
    service = (Router.query.service as string) || "",
    appId = (Router.query.app_id as string) || "",
    projectId = getCurrentProject().projectId,
    selector = (state: InitialStateType) => state,
    hookId,
    use,
    neverFetch,
    ...rest
}: UsePlaygroundStateOptions = {}) => {
    /**
     * SWR cache
     */
    const {cache} = useSWRConfig()

    /**
     * Key for the SWR cache
     */
    const key = useMemo(
        () => `/api/apps/${appId}/variants?project_id=${projectId}`,
        [appId, projectId],
    )

    const swrMiddleware = useCallback(
        <D = InitialStateType>(
            swrNext: (
                key: string | Key,
                fetcher: BareFetcher<D> | null,
                config: SWRConfiguration<D, Error, BareFetcher<D>>,
            ) => SWRResponse<D, Error>,
        ) =>
            (_key: string | Key, _fetcher: any, config: SWRConfiguration) => {
                const fetcher = async (url: string): Promise<InitialStateType> => {
                    if (!_key) return {} as InitialStateType

                    const state = cloneDeep(
                        !!cache.get(_key.toString()) ? cache.get(_key.toString()) : initialState,
                    ) as InitialStateType

                    if (!_fetcher) {
                        return {} as InitialStateType
                    }

                    const data = await _fetcher(url)
                    const areEqual = isEqual(state.variants, data)
                    if (!areEqual) {
                        state.variants = [...data].map((variant) => {
                            return {
                                appId: variant.app_id,
                                variantId: variant.variant_id,
                                baseId: variant.base_id,
                                baseName: variant.base_name,
                                variantName: variant.variant_name,
                                revision: variant.revision,
                                configName: variant.config_name,
                                projectId: variant.project_id,
                                appName: variant.app_name,
                            } as StateVariant
                        })
                    }

                    const jsonPromises = state.variants.map((variant) =>
                        openAPIJsonFetcher(variant, service),
                    )
                    const openapiJsons = await Promise.all(jsonPromises)

                    openapiJsons.forEach((json, index) => {
                        const stateVariant = state.variants.find(
                            (variant) => variant.variantId === json.variantId,
                        )
                        if (!stateVariant) {
                            console.error("Could not find variant for json", json)
                            return
                        }

                        stateVariant.schema = json.schema as OpenAPISchema
                    })

                    return state
                }

                const {data, ...rest} = swrNext(_key, fetcher as BareFetcher<D>, config)
                return {
                    data: (data as InitialStateType) || initialState,
                    ...rest,
                }
            },
        [cache, service],
    )

    const {data, isLoading, mutate} = useSWR<InitialStateType, Error>(key, {
        use: [swrMiddleware as Middleware, ...(use || [])],
        revalidateOnFocus: false,
        ...(neverFetch && {
            fetcher: undefined,
            revalidateOnMount: false,
            revalidateIfStale: false,
            revalidateOnFocus: false,
            revalidateOnReconnect: false,
            compare: () => true,
        }),
        ...rest,
    })

    const removeVariant = useCallback(
        (variantId: string) => {
            mutate(
                (state) => {
                    if (!state) return state
                    const clone = cloneDeep(state)

                    clone.variants = clone.variants.filter(
                        (variant) => variant.variantId !== variantId,
                    )
                    return clone
                },
                {
                    revalidate: false,
                },
            )
        },
        [mutate],
    )

    return {
        variants: data?.variants,
        loading: isLoading,
        removeVariant,
        mutate,
        key,
    }
}

export default usePlaygroundState
