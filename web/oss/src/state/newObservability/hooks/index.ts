import {useCallback} from "react"

import {useAtom, useAtomValue} from "jotai"

import {
    searchQueryAtom,
    traceTabsAtom,
    filtersAtom,
    sortAtom,
    paginationAtom,
    selectedTraceIdAtom,
    selectedRowKeysAtom,
    editColumnsAtom,
    testsetDrawerDataAtom,
    isAnnotationsSectionOpenAtom,
    selectedNodeAtom,
    DEFAULT_SORT,
} from "../atoms/controls"
import {
    tracesQueryAtom,
    annotationsQueryAtom,
    tracesWithAnnotationsAtom,
    traceCountAtom,
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
    const [pagination, setPagination] = useAtom(paginationAtom)
    const [selectedTraceId, setSelectedTraceId] = useAtom(selectedTraceIdAtom)
    const [selectedRowKeys, setSelectedRowKeys] = useAtom(selectedRowKeysAtom)
    const [editColumns, setEditColumns] = useAtom(editColumnsAtom)
    const [testsetDrawerData, setTestsetDrawerData] = useAtom(testsetDrawerDataAtom)
    const [isAnnotationsSectionOpen, setIsAnnotationsSectionOpen] = useAtom(
        isAnnotationsSectionOpenAtom,
    )
    const [selectedNode, setSelectedNode] = useAtom(selectedNodeAtom)

    const [{refetch: refetchTraces}] = useAtom(tracesQueryAtom)
    const [{data: annotationsData, refetch: refetchAnnotations}] = useAtom(annotationsQueryAtom)
    const traces = useAtomValue(tracesWithAnnotationsAtom)
    const count = useAtomValue(traceCountAtom)
    const isLoading = useAtomValue(observabilityLoadingAtom)
    const activeTraceIndex = useAtomValue(activeTraceIndexAtom)
    const activeTrace = useAtomValue(activeTraceAtom)
    const selectedItem = useAtomValue(selectedItemAtom)
    const annotations = annotationsData ?? []

    const fetchTraces = useCallback(async () => {
        const res = await refetchTraces()
        return res.data
    }, [refetchTraces])

    const fetchAnnotations = useCallback(async () => {
        const res = await refetchAnnotations()
        return res.data
    }, [refetchAnnotations])

    const navigateToPage = useCallback(
        async (newPage: number) => {
            setPagination((prev) => ({...prev, page: newPage}))
        },
        [setPagination],
    )

    const clearQueryStates = useCallback(() => {
        setSearchQuery("")
        setTraceTabs("tree")
        setFilters([])
        setSort(DEFAULT_SORT)
        setPagination({page: 1, size: 50})
    }, [setSearchQuery, setTraceTabs, setFilters, setSort, setPagination])

    return {
        traces,
        annotations,
        count,
        isLoading,
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
        pagination,
        setPagination,
        navigateToPage,
        selectedTraceId,
        setSelectedTraceId,
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
