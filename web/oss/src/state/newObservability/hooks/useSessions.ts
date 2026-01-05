import {useCallback} from "react"

import {useAtom, useAtomValue} from "jotai"

import {
    autoRefreshAtom,
    filtersAtom,
    realtimeModeAtom,
    searchQueryAtom,
    selectedTraceIdAtom,
    sortAtom,
    traceTabsAtom,
} from "../atoms/controls"
import {
    filteredSessionIdsAtom,
    sessionCountAtom,
    sessionsLoadingAtom,
    sessionsQueryAtom,
    sessionsSpansQueryAtom,
} from "../atoms/queries"

export const useSessions = () => {
    const [searchQuery, setSearchQuery] = useAtom(searchQueryAtom)
    const [traceTabs, setTraceTabs] = useAtom(traceTabsAtom)
    const [filters, setFilters] = useAtom(filtersAtom)
    const [sort, setSort] = useAtom(sortAtom)
    const [selectedTraceId, setSelectedTraceId] = useAtom(selectedTraceIdAtom)
    const [realtimeMode, setRealtimeMode] = useAtom(realtimeModeAtom)
    const [autoRefresh, setAutoRefresh] = useAtom(autoRefreshAtom)

    const [{refetch: refetchSessions, fetchNextPage, hasNextPage, isFetchingNextPage}] =
        useAtom(sessionsQueryAtom)

    const [{refetch: refetchSessionSpans}] = useAtom(sessionsSpansQueryAtom)

    const sessionIds = useAtomValue(filteredSessionIdsAtom)
    const sessionCount = useAtomValue(sessionCountAtom)
    const isLoading = useAtomValue(sessionsLoadingAtom)

    const fetchMoreSessions = useCallback(async () => {
        if (!hasNextPage) return
        await fetchNextPage()
    }, [fetchNextPage, hasNextPage])

    return {
        sessionIds,
        sessionCount,
        isLoading,
        fetchMoreSessions,
        hasMoreSessions: hasNextPage,
        isFetchingMore: isFetchingNextPage,
        refetchSessions,
        refetchSessionSpans,
        searchQuery,
        setSearchQuery,
        traceTabs,
        setTraceTabs,
        filters,
        setFilters,
        sort,
        setSort,
        selectedTraceId,
        setSelectedTraceId,
        realtimeMode,
        setRealtimeMode,
        autoRefresh,
        setAutoRefresh,
    }
}
