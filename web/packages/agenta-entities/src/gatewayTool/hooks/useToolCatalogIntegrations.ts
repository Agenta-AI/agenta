import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {atom, useAtomValue, useSetAtom} from "jotai"
import {atomWithInfiniteQuery} from "jotai-tanstack-query"

import {fetchToolIntegrations} from "../api"
import {dedupeBy} from "../core"
import type {
    ToolCatalogIntegration,
    ToolCatalogIntegrationDetails,
    ToolCatalogIntegrationsResponse,
} from "../core/types"

type CatalogIntegrationItem = ToolCatalogIntegration | ToolCatalogIntegrationDetails

const DEFAULT_PROVIDER = "composio"
const CHUNK_SIZE = 10
const PREFETCH = 2

// Server-side search atom — set by the drawer, drives the query
export const toolIntegrationsSearchAtom = atom("")

// Active category filter (Composio `category` slug), or null for "all apps". Search
// overrides it — an active search ignores the category axis (flat results).
export const toolIntegrationsCategoryAtom = atom<string | null>(null)

export const toolCatalogIntegrationsInfiniteAtom =
    atomWithInfiniteQuery<ToolCatalogIntegrationsResponse>((get) => {
        const search = get(toolIntegrationsSearchAtom)
        const effectiveSearch = search.length >= 3 ? search : ""
        // Search flattens across all categories, so the category filter only applies
        // when there is no active search.
        const category = effectiveSearch ? null : get(toolIntegrationsCategoryAtom)

        return {
            queryKey: [
                "tools",
                "catalog",
                "integrations",
                DEFAULT_PROVIDER,
                effectiveSearch,
                category ?? "",
            ],
            queryFn: async ({pageParam}) =>
                fetchToolIntegrations(DEFAULT_PROVIDER, {
                    search: effectiveSearch || undefined,
                    category: category || undefined,
                    limit: CHUNK_SIZE,
                    cursor: (pageParam as string) || undefined,
                    // Secondary (tool catalog / connected-tool names); yield to the render-critical
                    // playground queries. Low priority is a no-op once the drawer is open (no contention).
                    lowPriority: true,
                }),
            initialPageParam: "",
            getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
            staleTime: 5 * 60_000,
            refetchOnWindowFocus: false,
        }
    })

export const useToolCatalogIntegrations = () => {
    const query = useAtomValue(toolCatalogIntegrationsInfiniteAtom)
    const setSearch = useSetAtom(toolIntegrationsSearchAtom)
    const setCategory = useSetAtom(toolIntegrationsCategoryAtom)

    const integrations = useMemo<CatalogIntegrationItem[]>(() => {
        const pages = query.data?.pages ?? []
        // Dedupe by key across pagination boundaries — a cursor overlap can repeat an integration,
        // and duplicate React keys crash the grid render.
        return dedupeBy(
            pages.flatMap((p) => p.integrations ?? []),
            (i) => i?.key,
        )
    }, [query.data?.pages])

    const total = useMemo(() => {
        const pages = query.data?.pages ?? []
        return pages.length > 0 ? (pages[0].total ?? 0) : 0
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
        setCategory,
        refetch: query.refetch,
    }
}
