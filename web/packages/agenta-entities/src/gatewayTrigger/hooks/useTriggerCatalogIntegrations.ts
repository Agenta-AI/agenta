import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {atom, useAtomValue, useSetAtom} from "jotai"
import {atomWithInfiniteQuery} from "jotai-tanstack-query"

import {fetchTriggerIntegrations} from "../api"
import type {TriggerCatalogIntegration, TriggerCatalogIntegrationsResponse} from "../core/types"

const DEFAULT_PROVIDER = "composio"
const CHUNK_SIZE = 10
const PREFETCH = 2

// Server-side search atom — set by the drawer, drives the query.
export const triggerIntegrationsSearchAtom = atom("")

export const triggerCatalogIntegrationsInfiniteAtom =
    atomWithInfiniteQuery<TriggerCatalogIntegrationsResponse>((get) => {
        const search = get(triggerIntegrationsSearchAtom)

        return {
            queryKey: ["triggers", "catalog", "integrations", DEFAULT_PROVIDER, search],
            queryFn: async ({pageParam}) =>
                fetchTriggerIntegrations(DEFAULT_PROVIDER, {
                    search: search.length >= 3 ? search : undefined,
                    limit: CHUNK_SIZE,
                    cursor: (pageParam as string) || undefined,
                }),
            initialPageParam: "",
            getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
            staleTime: 5 * 60_000,
            refetchOnWindowFocus: false,
        }
    })

export const useTriggerCatalogIntegrations = () => {
    const query = useAtomValue(triggerCatalogIntegrationsInfiniteAtom)
    const setSearch = useSetAtom(triggerIntegrationsSearchAtom)

    const integrations = useMemo<TriggerCatalogIntegration[]>(() => {
        const pages = query.data?.pages ?? []
        return pages.flatMap((p) => p.integrations ?? [])
    }, [query.data?.pages])

    const total = useMemo(() => {
        const pages = query.data?.pages ?? []
        return pages.length > 0 ? (pages[0].total ?? 0) : 0
    }, [query.data?.pages])

    const [targetPages, setTargetPages] = useState(1 + PREFETCH)
    const loadedPages = query.data?.pages?.length ?? 0

    const prevLoadedRef = useRef(loadedPages)
    useEffect(() => {
        if (loadedPages === 0 && prevLoadedRef.current > 0) {
            setTargetPages(1 + PREFETCH)
        }
        prevLoadedRef.current = loadedPages
    }, [loadedPages])

    const requestMore = useCallback(() => {
        setTargetPages((t) => t + PREFETCH)
    }, [])

    useEffect(() => {
        if (loadedPages < targetPages && query.hasNextPage && !query.isFetchingNextPage) {
            query.fetchNextPage()
        }
    }, [loadedPages, targetPages, query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage])

    return {
        integrations,
        total,
        prefetchThreshold: PREFETCH * CHUNK_SIZE,
        isLoading: query.isPending,
        isFetchingNextPage: query.isFetchingNextPage,
        hasNextPage: query.hasNextPage ?? false,
        error: query.error,
        requestMore,
        setSearch,
    }
}
