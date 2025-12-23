import {useMemo} from "react"

import {atom, useStore} from "jotai"
import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import {evaluationPreviewTableStore} from "../../EvalRunDetails/evaluationPreviewTableStore"

interface UseComparisonPaginationsArgs {
    compareSlots: (string | null)[]
    pageSize: number
}

/**
 * Custom hook to handle multiple comparison paginations dynamically.
 * Instead of calling useInfiniteTablePagination multiple times (violating React hooks rules),
 * this creates a derived atom that reads from all comparison pagination atoms at once,
 * and provides imperative methods using the Jotai store directly.
 */
const useComparisonPaginations = ({compareSlots, pageSize}: UseComparisonPaginationsArgs) => {
    const store = useStore()

    // Create a derived atom that reads all comparison paginations dynamically
    const comparePaginationsAtom = useMemo(
        () =>
            atom((get) => {
                return compareSlots.map((scopeId) => {
                    if (!scopeId) {
                        return {
                            rows: [],
                            loadedRowCount: 0,
                            totalRows: 0,
                            paginationInfo: {
                                hasMore: false,
                                nextCursor: null,
                                nextOffset: null,
                                isFetching: false,
                                totalCount: null,
                                nextWindowing: null,
                            },
                            scopeId: null,
                        }
                    }

                    // Get the combined rows atom for this scopeId
                    const combinedRowsAtom =
                        evaluationPreviewTableStore.atoms.combinedRowsAtomFamily({
                            scopeId,
                            pageSize,
                        })
                    const rows = get(combinedRowsAtom)

                    // Get pagination info atom for this scopeId
                    const paginationInfoAtom =
                        evaluationPreviewTableStore.atoms.paginationInfoAtomFamily({
                            scopeId,
                            pageSize,
                        })
                    const paginationInfo = get(paginationInfoAtom)

                    const totalRows = rows.length
                    const loadedRowCount = rows.filter((row) => !row.__isSkeleton).length

                    return {
                        rows,
                        loadedRowCount,
                        totalRows,
                        paginationInfo,
                        scopeId,
                    }
                })
            }),
        [compareSlots, pageSize],
    )

    // Use low priority scheduling for performance
    const paginations = useAtomValueWithSchedule(comparePaginationsAtom, {
        priority: LOW_PRIORITY,
    })

    // Create loadNextPage and resetPages functions using the store directly
    const paginationsWithMethods = useMemo(() => {
        return paginations.map((pagination) => {
            if (!pagination.scopeId) {
                return {
                    ...pagination,
                    loadNextPage: () => {},
                    resetPages: () => {},
                }
            }

            const scopeId = pagination.scopeId

            // Create loadNextPage function that manipulates atoms directly via store
            const loadNextPage = () => {
                // Read fresh values from store at call time to avoid stale closures
                const paginationInfoAtom =
                    evaluationPreviewTableStore.atoms.paginationInfoAtomFamily({
                        scopeId,
                        pageSize,
                    })
                const combinedRowsAtom = evaluationPreviewTableStore.atoms.combinedRowsAtomFamily({
                    scopeId,
                    pageSize,
                })

                const paginationInfo = store.get(paginationInfoAtom)
                const rows = store.get(combinedRowsAtom)
                const totalRows = rows.length

                if (
                    !paginationInfo.hasMore ||
                    !paginationInfo.nextCursor ||
                    paginationInfo.isFetching
                ) {
                    return
                }

                const nextOffset = paginationInfo.nextOffset ?? totalRows
                const nextWindowing = paginationInfo.nextWindowing ?? {
                    next: paginationInfo.nextCursor,
                    order: "ascending" as const,
                    limit: pageSize,
                    stop: null,
                }

                const scheduleAtom = evaluationPreviewTableStore.atoms.scheduleNextPageAtomFamily({
                    scopeId,
                    pageSize,
                })

                store.set(scheduleAtom, {
                    nextCursor: paginationInfo.nextCursor,
                    nextOffset,
                    nextWindowing,
                    totalRows,
                })
            }

            // Create resetPages function that manipulates atoms directly via store
            const resetPages = () => {
                const pagesAtom = evaluationPreviewTableStore.atoms.pagesAtomFamily({
                    scopeId,
                    pageSize,
                })

                store.set(pagesAtom, {
                    pages: [evaluationPreviewTableStore.createInitialPage(pageSize)],
                })
            }

            return {
                ...pagination,
                loadNextPage,
                resetPages,
            }
        })
    }, [paginations, pageSize, store])

    return paginationsWithMethods
}

export default useComparisonPaginations
