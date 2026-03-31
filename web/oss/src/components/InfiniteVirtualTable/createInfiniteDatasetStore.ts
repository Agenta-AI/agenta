import type {Key} from "react"

import type {Atom, PrimitiveAtom} from "jotai"
import {atom, useAtom, useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"

import {createInfiniteTableStore} from "./createInfiniteTableStore"
import type {InfiniteTableStore} from "./createInfiniteTableStore"
import useInfiniteTablePagination from "./hooks/useInfiniteTablePagination"
import type {InfiniteTableFetchResult, InfiniteTableRowBase, WindowingState} from "./types"

interface ScopeParams {
    scopeId: string | null
}

interface TablePagesParams {
    scopeId: string | null
    pageSize: number
}

export interface InfiniteDatasetStoreConfig<Row extends InfiniteTableRowBase, ApiRow, Meta> {
    key: string
    metaAtom: Atom<Meta>
    createSkeletonRow: (params: {
        scopeId: string | null
        offset: number
        index: number
        windowing: WindowingState | null
        rowKey: string
    }) => Row
    mergeRow: (params: {skeleton: Row; apiRow?: ApiRow}) => Row
    fetchPage: (params: {
        meta: Meta
        limit: number
        offset: number
        cursor: string | null
        windowing: WindowingState | null
    }) => Promise<InfiniteTableFetchResult<ApiRow>>
    isEnabled?: (meta: Meta | undefined) => boolean
    /**
     * Optional atom that provides client-side rows (e.g., unsaved drafts)
     * These rows will be prepended to server rows
     */
    clientRowsAtom?: Atom<Row[]>
    /**
     * Optional atom providing IDs of rows to exclude from display
     * Useful for filtering out soft-deleted rows before save
     */
    excludeRowIdsAtom?: Atom<Set<string>>
}

export interface InfiniteDatasetStore<Row extends InfiniteTableRowBase, ApiRow, Meta> {
    store: InfiniteTableStore<Row, ApiRow>
    config: InfiniteDatasetStoreConfig<Row, ApiRow, Meta>
    atoms: {
        rowsAtom: (params: TablePagesParams) => Atom<Row[]>
        paginationAtom: (params: TablePagesParams) => Atom<{
            hasMore: boolean
            nextCursor: string | null
            nextOffset: number | null
            isFetching: boolean
            totalCount: number | null
            nextWindowing: WindowingState | null
        }>
        selectionAtom: (params: ScopeParams) => PrimitiveAtom<Key[]>
    }
    hooks: {
        usePagination: (params: {
            scopeId: string | null
            pageSize: number
            resetOnScopeChange?: boolean
        }) => ReturnType<typeof useInfiniteTablePagination<Row>>
        useRowSelection: (
            params: ScopeParams,
        ) => [Key[], (next: Key[] | ((prev: Key[]) => Key[])) => void]
    }
}

export const createInfiniteDatasetStore = <Row extends InfiniteTableRowBase, ApiRow, Meta>(
    config: InfiniteDatasetStoreConfig<Row, ApiRow, Meta>,
): InfiniteDatasetStore<Row, ApiRow, Meta> => {
    const selectionAtomFamily = atomFamily(
        ({scopeId}: ScopeParams) => atom<Key[]>([]),
        (a, b) => a.scopeId === b.scopeId,
    )

    const tableStore = createInfiniteTableStore<Row, ApiRow, Meta>({
        key: config.key,
        createSkeletonRow: config.createSkeletonRow,
        mergeRow: config.mergeRow,
        getQueryMeta: ({get}) => get(config.metaAtom),
        isEnabled: ({meta}) => {
            if (config.isEnabled) {
                return config.isEnabled(meta)
            }
            return Boolean(meta)
        },
        fetchPage: async ({limit, offset, cursor, windowing, meta}) => {
            if (!meta) {
                return {
                    rows: [],
                    totalCount: 0,
                    hasMore: false,
                    nextOffset: null,
                    nextCursor: null,
                    nextWindowing: null,
                }
            }

            return config.fetchPage({
                meta,
                limit,
                offset,
                cursor,
                windowing,
            })
        },
    })

    // Create custom pagination hook that uses wrapped atoms (with client rows)
    const usePagination = ({
        scopeId,
        pageSize,
        resetOnScopeChange,
    }: {
        scopeId: string | null
        pageSize: number
        resetOnScopeChange?: boolean
    }) => {
        // Get the base pagination result from tableStore
        const basePagination = useInfiniteTablePagination<Row>({
            store: tableStore,
            scopeId,
            pageSize,
            resetOnScopeChange,
        })

        // Always get wrapped atoms (even if not using them - to satisfy rules of hooks)
        const wrappedRowsAtom = rowsWithClientAtomFamily({scopeId, pageSize})
        const wrappedPaginationAtom = paginationWithClientAtomFamily({scopeId, pageSize})

        // Always read from wrapped atoms (rules of hooks)
        const wrappedRows = useAtomValue(wrappedRowsAtom) as Row[]
        const wrappedPaginationInfo = useAtomValue(wrappedPaginationAtom)

        // If no client rows, return base pagination as-is
        if (!config.clientRowsAtom) {
            return basePagination
        }

        // Override with wrapped data
        return {
            ...basePagination,
            rows: wrappedRows,
            rowsAtom: wrappedRowsAtom,
            totalRows: wrappedPaginationInfo.totalCount || 0,
            paginationInfo: wrappedPaginationInfo,
        }
    }

    const useRowSelection = ({scopeId}: ScopeParams) => useAtom(selectionAtomFamily({scopeId}))

    // Create wrapper atoms that merge client rows if clientRowsAtom is provided
    // Use atomFamily to cache derived atoms by params
    const rowsWithClientAtomFamily = atomFamily(
        (params: TablePagesParams) => {
            const baseRowsAtom = tableStore.atoms.combinedRowsAtomFamily(params)

            return atom((get) => {
                let baseRows = get(baseRowsAtom)

                // Apply exclusion filter if provided (e.g., filter out soft-deleted rows)
                if (config.excludeRowIdsAtom) {
                    const excludeIds = get(config.excludeRowIdsAtom)
                    baseRows = baseRows.filter((row) => {
                        const rowId =
                            (typeof row.id === "string" || typeof row.id === "number"
                                ? String(row.id)
                                : null) ?? String(row.key)
                        return !excludeIds.has(rowId)
                    })
                }

                // Guard: only read from clientRowsAtom if it exists
                if (!config.clientRowsAtom) {
                    return baseRows
                }

                const clientRows = get(config.clientRowsAtom)

                // Prepend client rows to server rows
                return [...clientRows, ...baseRows]
            })
        },
        (a, b) => a.scopeId === b.scopeId && a.pageSize === b.pageSize,
    )

    const paginationWithClientAtomFamily = atomFamily(
        (params: TablePagesParams) => {
            const basePaginationAtom = tableStore.atoms.paginationInfoAtomFamily(params)
            const baseRowsAtom = tableStore.atoms.combinedRowsAtomFamily(params)

            return atom((get) => {
                const basePagination = get(basePaginationAtom)

                // Calculate actual count after filtering excluded rows
                let serverRowCount = basePagination.totalCount || 0
                if (config.excludeRowIdsAtom) {
                    const excludeIds = get(config.excludeRowIdsAtom)
                    const baseRows = get(baseRowsAtom)
                    serverRowCount = baseRows.filter((row) => {
                        const rowId =
                            (typeof row.id === "string" || typeof row.id === "number"
                                ? String(row.id)
                                : null) ?? String(row.key)
                        return !excludeIds.has(rowId)
                    }).length
                }

                // Guard: only read from clientRowsAtom if it exists
                if (!config.clientRowsAtom) {
                    return {
                        ...basePagination,
                        totalCount: serverRowCount,
                    }
                }

                const clientRows = get(config.clientRowsAtom)

                return {
                    ...basePagination,
                    totalCount: serverRowCount + clientRows.length,
                }
            })
        },
        (a, b) => a.scopeId === b.scopeId && a.pageSize === b.pageSize,
    )

    const rowsAtomGetter = (params: TablePagesParams) => {
        if (!config.clientRowsAtom) {
            return tableStore.atoms.combinedRowsAtomFamily(params)
        }
        return rowsWithClientAtomFamily(params)
    }

    const paginationAtomGetter = (params: TablePagesParams) => {
        if (!config.clientRowsAtom) {
            return tableStore.atoms.paginationInfoAtomFamily(params)
        }
        return paginationWithClientAtomFamily(params)
    }

    return {
        store: tableStore,
        config,
        atoms: {
            rowsAtom: rowsAtomGetter,
            paginationAtom: paginationAtomGetter,
            selectionAtom: (params) => selectionAtomFamily(params),
        },
        hooks: {
            usePagination,
            useRowSelection,
        },
    }
}
