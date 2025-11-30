import type {Key} from "react"

import type {Atom, PrimitiveAtom} from "jotai"
import {atom, useAtom} from "jotai"
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

    const usePagination = ({
        scopeId,
        pageSize,
        resetOnScopeChange,
    }: {
        scopeId: string | null
        pageSize: number
        resetOnScopeChange?: boolean
    }) =>
        useInfiniteTablePagination<Row>({
            store: tableStore,
            scopeId,
            pageSize,
            resetOnScopeChange,
        })

    const useRowSelection = ({scopeId}: ScopeParams) => useAtom(selectionAtomFamily({scopeId}))

    return {
        store: tableStore,
        config,
        atoms: {
            rowsAtom: (params) => tableStore.atoms.combinedRowsAtomFamily(params),
            paginationAtom: (params) => tableStore.atoms.paginationInfoAtomFamily(params),
            selectionAtom: (params) => selectionAtomFamily(params),
        },
        hooks: {
            usePagination,
            useRowSelection,
        },
    }
}
