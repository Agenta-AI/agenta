import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {atom, useAtomValue, useSetAtom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithInfiniteQuery} from "jotai-tanstack-query"

import {fetchActions} from "@/oss/services/tools/api"
import type {ActionItem, ActionsListResponse} from "@/oss/services/tools/api/types"

const DEFAULT_PROVIDER = "composio"
const CHUNK_SIZE = 10
const PREFETCH = 2

// Server-side search atom — set by the drawer, drives the query
export const actionsSearchAtom = atom("")

export const catalogActionsInfiniteFamily = atomFamily((integrationKey: string) =>
    atomWithInfiniteQuery<ActionsListResponse>((get) => {
        const search = get(actionsSearchAtom)

        return {
            queryKey: ["tools", "catalog", "actions", DEFAULT_PROVIDER, integrationKey, search],
            queryFn: async ({pageParam}) =>
                fetchActions(DEFAULT_PROVIDER, integrationKey, {
                    query: search || undefined,
                    limit: CHUNK_SIZE,
                    cursor: (pageParam as string) || undefined,
                }),
            initialPageParam: "",
            getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
            staleTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            enabled: !!integrationKey,
        }
    }),
)

export const useCatalogActions = (integrationKey: string) => {
    const query = useAtomValue(catalogActionsInfiniteFamily(integrationKey))
    const setSearch = useSetAtom(actionsSearchAtom)

    const actions = useMemo<ActionItem[]>(() => {
        const pages = query.data?.pages ?? []
        return pages.flatMap((p) => p.actions)
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
