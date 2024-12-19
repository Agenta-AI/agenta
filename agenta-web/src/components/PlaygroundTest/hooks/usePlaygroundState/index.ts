import {useCallback, useEffect, useMemo, useRef} from "react"
import isEqual from "lodash/isEqual"

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
import type {InitialStateType} from "../../state/types"
import type {UsePlaygroundStateOptions} from "../usePlaygroundState/types"
import {fetchAndUpdateVariants, setVariants} from "./assets/helpers"
import cloneDeep from "lodash/cloneDeep"
import {initialState} from "./assets/constants"
import {reduceRight} from "lodash"

function trackIsDirty(useSWRNext) {
    return (key, fetcher, config) => {
        const dataRef = useRef(new Map())
        const dirtyRef = useRef(new Map<string, boolean>())

        const swr = useSWRNext(key, fetcher, config)
        const {isLoading, data, mutate} = swr

        const setIsDirty = useCallback(
            (variantId: string, isDirty: boolean) => {
                dirtyRef.current.set(variantId, isDirty)
                mutate(
                    (currentData) => ({
                        ...currentData,
                        dirtyStates: new Map(dirtyRef.current),
                    }),
                    {revalidate: false},
                )
            },
            [mutate],
        )

        useEffect(() => {
            if (data !== undefined && !isLoading) {
                const variants = data.variants
                let hasChanges = false

                variants.forEach((variant) => {
                    const variantId = variant.variantId
                    if (!dataRef.current.has(variantId)) {
                        dataRef.current.set(variantId, variant)
                        if (dirtyRef.current.get(variantId) !== false) {
                            dirtyRef.current.set(variantId, false)
                            hasChanges = true
                        }
                    } else {
                        const initialVariant = dataRef.current.get(variantId)
                        const newDirtyState = !isEqual(initialVariant, variant)
                        if (dirtyRef.current.get(variantId) !== newDirtyState) {
                            dirtyRef.current.set(variantId, newDirtyState)
                            hasChanges = true
                        }
                    }
                })

                // Cleanup and check for removed variants
                const currentVariantIds = variants.map((v) => v.variantId)
                dirtyRef.current.forEach((_, key) => {
                    if (!currentVariantIds.includes(key)) {
                        dataRef.current.delete(key)
                        dirtyRef.current.delete(key)
                        hasChanges = true
                    }
                })

                if (hasChanges) {
                    mutate(
                        (currentData) => ({
                            ...currentData,
                            dirtyStates: new Map(dirtyRef.current),
                        }),
                        {revalidate: false},
                    )
                }
            }
        }, [data, isLoading, mutate])

        return Object.assign({}, swr, {
            setIsDirty,
            get isDirty() {
                // TODO: check if this is accessed. if so
                // create a ref to control the re-renders
                // set a reference to the dirtyRef.current to avoid re-renders
                return config.variantId
                    ? data?.dirtyStates?.get(config.variantId) || false
                    : undefined
            },
        })
    }
}

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
                    state.variants = setVariants(state.variants, data)

                    await fetchAndUpdateVariants(state.variants, service)

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

    const swr = useSWR<InitialStateType, Error>(key, {
        use: [trackIsDirty, swrMiddleware as Middleware, ...(use || [])],
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

    return Object.assign({}, swr, {projectId, service, variants: swr.data?.variants || []})
}

export default usePlaygroundState
