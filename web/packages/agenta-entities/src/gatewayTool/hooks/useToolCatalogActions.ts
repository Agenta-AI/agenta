import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {catalogPersister} from "@agenta/shared/api/persist"
import type {QueryKey, QueryPersister} from "@tanstack/react-query"
import {atom, useAtomValue, useSetAtom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithInfiniteQuery} from "jotai-tanstack-query"

import {fetchToolActions} from "../api"
import type {
    ToolCatalogAction,
    ToolCatalogActionDetails,
    ToolCatalogActionsResponse,
} from "../core/types"

type CatalogActionItem = ToolCatalogAction | ToolCatalogActionDetails

const DEFAULT_PROVIDER = "composio"
const CHUNK_SIZE = 10
const PREFETCH = 2

// Server-side search atom — set by the drawer, drives the query
export const toolActionsSearchAtom = atom("")

export const toolCatalogActionsInfiniteFamily = atomFamily((integrationKey: string) =>
    atomWithInfiniteQuery<ToolCatalogActionsResponse>((get) => {
        const search = get(toolActionsSearchAtom)

        return {
            queryKey: ["tools", "catalog", "actions", DEFAULT_PROVIDER, integrationKey, search],
            queryFn: async ({pageParam}) =>
                fetchToolActions(DEFAULT_PROVIDER, integrationKey, {
                    query: search || undefined,
                    limit: CHUNK_SIZE,
                    cursor: (pageParam as string) || undefined,
                }),
            initialPageParam: "",
            getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
            staleTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            enabled: !!integrationKey,
            // Persists whole {pages, pageParams}; cast bridges persisterFn's pageParam-less typing.
            persister: catalogPersister.persisterFn as QueryPersister<
                ToolCatalogActionsResponse,
                QueryKey,
                unknown
            >,
        }
    }),
)

export const useToolCatalogActions = (integrationKey: string) => {
    const query = useAtomValue(toolCatalogActionsInfiniteFamily(integrationKey))
    const setSearch = useSetAtom(toolActionsSearchAtom)

    const actions = useMemo<CatalogActionItem[]>(() => {
        const pages = query.data?.pages ?? []
        return pages.flatMap((p) => p.actions ?? [])
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
        actions,
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
