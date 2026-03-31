import {useCallback, useEffect, useMemo} from "react"

import {useSetAtom} from "jotai"
import {LOW_PRIORITY, useAtomValueWithSchedule, useSetAtomWithSchedule} from "jotai-scheduler"

import type {InfiniteTableStore} from "../createInfiniteTableStore"
import type {InfiniteTableRowBase, WindowingState} from "../types"

interface UseInfiniteTablePaginationArgs<TableRow extends InfiniteTableRowBase> {
    store: InfiniteTableStore<TableRow, unknown>
    scopeId: string | null
    pageSize: number
    resetOnScopeChange?: boolean
}

interface PaginationResult<TableRow extends InfiniteTableRowBase> {
    rows: TableRow[]
    rowsAtom: ReturnType<InfiniteTableStore<TableRow, unknown>["atoms"]["combinedRowsAtomFamily"]>
    loadedRowCount: number
    totalRows: number
    loadNextPage: () => void
    resetPages: () => void
    paginationInfo: {
        hasMore: boolean
        nextCursor: string | null
        nextOffset: number | null
        isFetching: boolean
        totalCount: number | null
        nextWindowing: WindowingState | null
    }
}

const useInfiniteTablePagination = <TableRow extends InfiniteTableRowBase>({
    store,
    scopeId,
    pageSize,
    resetOnScopeChange = true,
}: UseInfiniteTablePaginationArgs<TableRow>): PaginationResult<TableRow> => {
    const debugEnabled = process.env.NEXT_PUBLIC_IVT_DEBUG === "true"
    const pagesAtom = useMemo(
        () => store.atoms.pagesAtomFamily({scopeId, pageSize}),
        [store, scopeId, pageSize],
    )
    const combinedRowsAtom = useMemo(
        () => store.atoms.combinedRowsAtomFamily({scopeId, pageSize}),
        [store, scopeId, pageSize],
    )
    const paginationInfoAtom = useMemo(
        () => store.atoms.paginationInfoAtomFamily({scopeId, pageSize}),
        [store, scopeId, pageSize],
    )
    const scheduleAtom = useMemo(
        () => store.atoms.scheduleNextPageAtomFamily({scopeId, pageSize}),
        [store, scopeId, pageSize],
    )

    const setPagesState = useSetAtom(pagesAtom)
    const scheduleNextPage = useSetAtomWithSchedule(scheduleAtom, {
        priority: LOW_PRIORITY,
    })
    const rows = useAtomValueWithSchedule(combinedRowsAtom, {
        priority: LOW_PRIORITY,
    }) as TableRow[]
    const paginationInfo = useAtomValueWithSchedule(paginationInfoAtom, {
        priority: LOW_PRIORITY,
    }) as PaginationResult<TableRow>["paginationInfo"]

    const resetPages = useCallback(() => {
        setPagesState({
            pages: [store.createInitialPage(pageSize)],
        })
    }, [pageSize, setPagesState, store])

    useEffect(() => {
        if (!resetOnScopeChange) return
        resetPages()
    }, [resetOnScopeChange, resetPages, scopeId])

    const totalRows = rows.length
    const loadedRowCount = useMemo(() => rows.filter((row) => !row.__isSkeleton).length, [rows])

    const loadNextPage = useCallback(() => {
        if (!paginationInfo.hasMore) {
            return
        }
        const nextCursor = paginationInfo.nextCursor
        if (!nextCursor || paginationInfo.isFetching) {
            return
        }

        const nextOffset = paginationInfo.nextOffset ?? totalRows
        const nextWindowing =
            paginationInfo.nextWindowing ??
            ({
                next: nextCursor,
                order: "ascending",
                limit: pageSize,
                stop: null,
            } as WindowingState)

        if (debugEnabled) {
            const skeletonCount = rows.filter((row) => row.__isSkeleton).length

            console.log("[IVT] scheduling next page", {
                scopeId,
                nextCursor,
                nextOffset,
                totalRows,
                skeletonCount,
            })
        }

        scheduleNextPage({
            nextCursor,
            nextOffset,
            nextWindowing,
            totalRows,
        })
    }, [
        debugEnabled,
        pageSize,
        paginationInfo.hasMore,
        paginationInfo.isFetching,
        paginationInfo.nextCursor,
        paginationInfo.nextOffset,
        paginationInfo.nextWindowing,
        rows,
        scheduleNextPage,
        scopeId,
        totalRows,
    ])

    return {
        rows,
        rowsAtom: combinedRowsAtom,
        loadedRowCount,
        totalRows,
        loadNextPage,
        resetPages,
        paginationInfo,
    }
}

export default useInfiniteTablePagination
