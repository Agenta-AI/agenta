import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {atom, useAtomValue, useSetAtom} from "jotai"
import {atomWithInfiniteQuery} from "jotai-tanstack-query"

import {fetchIntegrations} from "@/oss/services/tools/api"
import type {IntegrationItem, IntegrationsResponse} from "@/oss/services/tools/api/types"

const DEFAULT_PROVIDER = "composio"
const CHUNK_SIZE = 10
const PREFETCH = 2

// Server-side search atom — set by the drawer, drives the query
export const integrationsSearchAtom = atom("")

export const catalogIntegrationsInfiniteAtom = atomWithInfiniteQuery<IntegrationsResponse>(
    (get) => {
        const search = get(integrationsSearchAtom)

        return {
            queryKey: ["tools", "catalog", "integrations", DEFAULT_PROVIDER, search],
            queryFn: async ({pageParam}) =>
                fetchIntegrations(DEFAULT_PROVIDER, {
                    search: search || undefined,
                    limit: CHUNK_SIZE,
                    cursor: (pageParam as string) || undefined,
                }),
            initialPageParam: "",
            getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
            staleTime: 5 * 60_000,
            refetchOnWindowFocus: false,
        }
    },
)

export const useCatalogIntegrations = () => {
    const query = useAtomValue(catalogIntegrationsInfiniteAtom)
    const setSearch = useSetAtom(integrationsSearchAtom)

    const integrations = useMemo<IntegrationItem[]>(() => {
        const pages = query.data?.pages ?? []
        return pages.flatMap((p) => p.integrations)
    }, [query.data?.pages])

    const total = useMemo(() => {
        const pages = query.data?.pages ?? []
        return pages.length > 0 ? pages[0].total : 0
    }, [query.data?.pages])

    // --- Prefetch logic ---
    // targetPages = minimum number of pages we want loaded.
    // Starts at 1 + PREFETCH (initial load + prefetch buffer).
    // Each sentinel hit adds PREFETCH more (replenish the buffer).
    const [targetPages, setTargetPages] = useState(1 + PREFETCH)
    const loadedPages = query.data?.pages?.length ?? 0

    // Reset target when query resets (search change clears pages)
    const prevLoadedRef = useRef(loadedPages)
    useEffect(() => {
        if (loadedPages === 0 && prevLoadedRef.current > 0) {
            setTargetPages(1 + PREFETCH)
        }
        prevLoadedRef.current = loadedPages
    }, [loadedPages])

    // Sentinel callback — user scrolled to the prefetch point, request PREFETCH more pages
    const requestMore = useCallback(() => {
        setTargetPages((t) => t + PREFETCH)
    }, [])

    // Keep fetching until loaded >= target
    useEffect(() => {
        if (loadedPages < targetPages && query.hasNextPage && !query.isFetchingNextPage) {
            query.fetchNextPage()
        }
    }, [loadedPages, targetPages, query.hasNextPage, query.isFetchingNextPage])

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
