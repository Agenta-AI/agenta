import {useCallback, useMemo} from "react"

import {useAtom, useAtomValue} from "jotai"

import {
    searchQueryAtom,
    traceTabsAtom,
    filtersAtom,
    sortAtom,
    selectedTraceIdAtom,
    selectedRowKeysAtom,
    editColumnsAtom,
    testsetDrawerDataAtom,
    isAnnotationsSectionOpenAtom,
    selectedNodeAtom,
    DEFAULT_SORT,
    limitAtom,
} from "../atoms/controls"
import {
    tracesQueryAtom,
    annotationsQueryAtom,
    tracesWithAnnotationsAtom,
    observabilityLoadingAtom,
    activeTraceIndexAtom,
    activeTraceAtom,
    selectedItemAtom,
} from "../atoms/queries"

export const useObservability = () => {
    const [searchQuery, setSearchQuery] = useAtom(searchQueryAtom)
    const [traceTabs, setTraceTabs] = useAtom(traceTabsAtom)
    const [filters, setFilters] = useAtom(filtersAtom)
    const [sort, setSort] = useAtom(sortAtom)
    const [selectedTraceId, setSelectedTraceId] = useAtom(selectedTraceIdAtom)
    const [selectedRowKeys, setSelectedRowKeys] = useAtom(selectedRowKeysAtom)
    const [editColumns, setEditColumns] = useAtom(editColumnsAtom)
    const [testsetDrawerData, setTestsetDrawerData] = useAtom(testsetDrawerDataAtom)
    const [isAnnotationsSectionOpen, setIsAnnotationsSectionOpen] = useAtom(
        isAnnotationsSectionOpenAtom,
    )
    const [selectedNode, setSelectedNode] = useAtom(selectedNodeAtom)
    const [limit] = useAtom(limitAtom)

    const [
        {
            refetch: refetchTraces,
            fetchNextPage,
            hasNextPage,
            isFetchingNextPage,
            isLoading: isLoadingTraces,
            isFetching: isFetchingTraces,
            isRefetching: isRefetchingTraces,
        },
    ] = useAtom(tracesQueryAtom)

    const [
        {
            data: annotationsData,
            refetch: refetchAnnotations,
            isLoading: isLoadingAnnotations,
            isFetching: isFetchingAnnotations,
            isRefetching: isRefetchingAnnotations,
        },
    ] = useAtom(annotationsQueryAtom)

    const isLoadingObservability = useAtomValue(observabilityLoadingAtom)

    const traces = useAtomValue(tracesWithAnnotationsAtom)
    const activeTraceIndex = useAtomValue(activeTraceIndexAtom)
    const activeTrace = useAtomValue(activeTraceAtom)
    const selectedItem = useAtomValue(selectedItemAtom)
    const annotations = annotationsData ?? []

    const isRefreshing = useMemo(
        () =>
            isFetchingTraces ||
            isFetchingAnnotations ||
            isRefetchingTraces ||
            isRefetchingAnnotations,
        [isFetchingTraces, isFetchingAnnotations, isRefetchingTraces, isRefetchingAnnotations],
    )

    const fetchTraces = useCallback(async () => {
        const res = await refetchTraces()
        return res.data
    }, [refetchTraces])

    const fetchAnnotations = useCallback(async () => {
        const res = await refetchAnnotations()
        return res.data
    }, [refetchAnnotations])

    const fetchMoreTraces = useCallback(async () => {
        if (!hasNextPage) return []
        const res = await fetchNextPage()
        const pages = res.data?.pages || []
        return pages.length ? pages[pages.length - 1].traces : []
    }, [fetchNextPage, hasNextPage])

    const clearQueryStates = useCallback(() => {
        setSearchQuery("")
        setTraceTabs("trace")
        setFilters([])
        setSort(DEFAULT_SORT)
    }, [setSearchQuery, setTraceTabs, setFilters, setSort])

    return {
        traces,
        annotations,
        isLoading:
            isLoadingObservability || isLoadingTraces || isLoadingAnnotations || isRefreshing,
        fetchMoreTraces,
        hasMoreTraces: hasNextPage,
        isFetchingMore: isFetchingNextPage,
        fetchTraces,
        fetchAnnotations,
        clearQueryStates,
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
        limit,
        selectedRowKeys,
        setSelectedRowKeys,
        editColumns,
        setEditColumns,
        testsetDrawerData,
        setTestsetDrawerData,
        isAnnotationsSectionOpen,
        setIsAnnotationsSectionOpen,
        selectedNode,
        setSelectedNode,
        activeTraceIndex,
        activeTrace,
        selectedItem,
    }
}
