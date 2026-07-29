import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {catalogPersister} from "@agenta/shared/api/persist"
import type {QueryKey, QueryPersister} from "@tanstack/react-query"
import {atom, useAtomValue, useSetAtom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithInfiniteQuery} from "jotai-tanstack-query"

import {fetchTriggerEvents} from "../api"
import type {TriggerCatalogEvent, TriggerCatalogEventsResponse} from "../core/types"

const DEFAULT_PROVIDER = "composio"
const CHUNK_SIZE = 10
const PREFETCH = 2

// Server-side search atom — set by the drawer, drives the query
export const triggerEventsSearchAtom = atom("")

export const triggerCatalogEventsInfiniteFamily = atomFamily((integrationKey: string) =>
    atomWithInfiniteQuery<TriggerCatalogEventsResponse>((get) => {
        const search = get(triggerEventsSearchAtom)

        return {
            queryKey: ["triggers", "catalog", "events", DEFAULT_PROVIDER, integrationKey, search],
            queryFn: async ({pageParam}) =>
                fetchTriggerEvents(DEFAULT_PROVIDER, integrationKey, {
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
                TriggerCatalogEventsResponse,
                QueryKey,
                unknown
            >,
        }
    }),
)

export const useTriggerCatalogEvents = (integrationKey: string) => {
    const query = useAtomValue(triggerCatalogEventsInfiniteFamily(integrationKey))
    const setSearch = useSetAtom(triggerEventsSearchAtom)

    const events = useMemo<TriggerCatalogEvent[]>(() => {
        const pages = query.data?.pages ?? []
        return pages.flatMap((p) => p.events ?? [])
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
        if (
            loadedPages < targetPages &&
            query.hasNextPage &&
            !query.isFetchingNextPage &&
            !query.isError
        ) {
            query.fetchNextPage()
        }
    }, [
        loadedPages,
        targetPages,
        query.hasNextPage,
        query.isFetchingNextPage,
        query.isError,
        query.fetchNextPage,
    ])

    return {
        events,
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
