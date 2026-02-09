/**
 * Infinite Table Store
 *
 * Core store for managing infinite scrolling table data with pagination.
 * Uses jotai-tanstack-query for data fetching and caching.
 *
 * Copied from @agenta/ui to avoid dependency.
 */

import {atom} from "jotai"
import type {Atom, WritableAtom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"
import type {AtomWithQueryResult} from "jotai-tanstack-query"
import {v4 as uuidv4} from "uuid"

import type {
    InfiniteTableFetchParams,
    InfiniteTableFetchResult,
    InfiniteTablePage,
    InfiniteTableRowBase,
    WindowingState,
} from "../tableTypes"

export interface TableRowAtomKey {
    scopeId: string | null
    offset: number
    limit: number
    cursor: string | null
    windowing?: WindowingState | null
}

export interface TablePagesKey {
    scopeId: string | null
    pageSize: number
}

const createRandomId = () => uuidv4()

type PagesWriteArg =
    | {pages: InfiniteTablePage[]}
    | ((prev: {pages: InfiniteTablePage[]}) => {
          pages: InfiniteTablePage[]
      })

type ScheduleWriteArg = null | {
    nextCursor: string
    nextOffset: number
    nextWindowing: WindowingState | null
    totalRows: number
}

export interface InfiniteTableStore<TableRow extends InfiniteTableRowBase, ApiRow> {
    key: string
    atoms: {
        pagesAtomFamily: (
            params: TablePagesKey,
        ) => WritableAtom<{pages: InfiniteTablePage[]}, [PagesWriteArg], void>
        scheduleNextPageAtomFamily: (
            params: TablePagesKey,
        ) => WritableAtom<null, [ScheduleWriteArg], void>
        combinedRowsAtomFamily: (params: TablePagesKey) => Atom<TableRow[]>
        paginationInfoAtomFamily: (params: TablePagesKey) => Atom<{
            hasMore: boolean
            nextCursor: string | null
            nextOffset: number | null
            isFetching: boolean
            totalCount: number | null
            nextWindowing: WindowingState | null
        }>
        rowsAtomFamily: (params: TableRowAtomKey) => Atom<TableRow[]>
        rowsQueryAtomFamily: (
            params: TableRowAtomKey,
        ) => WritableAtom<AtomWithQueryResult<InfiniteTableFetchResult<ApiRow>>, [], void>
    }
    createInitialPage: (pageSize: number) => InfiniteTablePage
}

interface CreateInfiniteTableStoreOptions<
    TableRow extends InfiniteTableRowBase,
    ApiRow,
    TMeta = unknown,
> {
    key: string
    createSkeletonRow: (params: {
        scopeId: string | null
        offset: number
        index: number
        windowing: WindowingState | null
        rowKey: string
    }) => TableRow
    mergeRow: (params: {skeleton: TableRow; apiRow?: ApiRow}) => TableRow
    fetchPage: (
        params: InfiniteTableFetchParams<TMeta>,
    ) => Promise<InfiniteTableFetchResult<ApiRow>>
    getQueryMeta?: (params: {
        scopeId: string | null
        get: InfiniteTableFetchParams<TMeta>["get"]
    }) => TMeta
    isEnabled?: (params: {scopeId: string | null; meta: TMeta | undefined}) => boolean
    keyEquals?: {
        row?: (a: TableRowAtomKey, b: TableRowAtomKey) => boolean
        page?: (a: TablePagesKey, b: TablePagesKey) => boolean
    }
    staleTime?: number
    gcTime?: number
}

export const createInfiniteTableStore = <
    TableRow extends InfiniteTableRowBase,
    ApiRow,
    TMeta = unknown,
>(
    options: CreateInfiniteTableStoreOptions<TableRow, ApiRow, TMeta>,
): InfiniteTableStore<TableRow, ApiRow> => {
    const skeletonRowsCache = new Map<string, TableRow[]>()

    const makeCacheKey = ({scopeId, offset, limit, cursor, windowing}: TableRowAtomKey) =>
        `${options.key}:${scopeId ?? "scope"}:${offset}:${limit}:${cursor ?? "start"}:$${
            windowing?.next ?? ""
        }:${windowing?.stop ?? ""}`

    const ensureSkeletonRows = (key: TableRowAtomKey) => {
        const cacheKey = makeCacheKey(key)
        let rows = skeletonRowsCache.get(cacheKey)
        if (!rows) {
            rows = Array.from({length: key.limit}, (_, index) =>
                options.createSkeletonRow({
                    scopeId: key.scopeId,
                    offset: key.offset,
                    index,
                    windowing: key.windowing ?? null,
                    rowKey: createRandomId(),
                }),
            )
            skeletonRowsCache.set(cacheKey, rows)
        }
        return rows
    }

    const rowsKeyEquals =
        options.keyEquals?.row ??
        ((a: TableRowAtomKey, b: TableRowAtomKey) => {
            return (
                a.scopeId === b.scopeId &&
                a.offset === b.offset &&
                a.limit === b.limit &&
                a.cursor === b.cursor &&
                (a.windowing?.next ?? null) === (b.windowing?.next ?? null) &&
                (a.windowing?.stop ?? null) === (b.windowing?.stop ?? null)
            )
        })

    const pagesKeyEquals =
        options.keyEquals?.page ??
        ((a: TablePagesKey, b: TablePagesKey) => {
            return a.scopeId === b.scopeId && a.pageSize === b.pageSize
        })

    const tableRowsQueryAtomFamily = atomFamily(
        (params: TableRowAtomKey) =>
            atomWithQuery<InfiniteTableFetchResult<ApiRow>>((get) => {
                const meta = options.getQueryMeta?.({scopeId: params.scopeId, get})
                const metaKey = meta === undefined ? null : JSON.stringify(meta)
                const enabled = options.isEnabled
                    ? options.isEnabled({scopeId: params.scopeId, meta})
                    : Boolean(params.scopeId)

                return {
                    queryKey: [
                        options.key,
                        params.scopeId,
                        params.cursor,
                        params.limit,
                        params.offset,
                        params.windowing?.next ?? null,
                        params.windowing?.stop ?? null,
                        metaKey,
                    ],
                    enabled,
                    staleTime: options.staleTime ?? 15_000,
                    gcTime: options.gcTime ?? 60_000,
                    refetchOnWindowFocus: false,
                    refetchOnReconnect: false,
                    placeholderData: (previousData: InfiniteTableFetchResult<ApiRow> | undefined) =>
                        previousData,
                    queryFn: async () => {
                        return options.fetchPage({
                            scopeId: params.scopeId,
                            cursor: params.cursor,
                            limit: params.limit,
                            offset: params.offset,
                            windowing: params.windowing ?? null,
                            meta,
                            get,
                        })
                    },
                }
            }),
        rowsKeyEquals,
    )

    const tableSkeletonRowsAtomFamily = atomFamily(
        (key: TableRowAtomKey) =>
            atom<TableRow[]>(() => {
                return ensureSkeletonRows(key)
            }),
        rowsKeyEquals,
    )

    const tableRowsAtomFamily = atomFamily(
        (key: TableRowAtomKey) =>
            atom((get) => {
                const skeletonRows = get(tableSkeletonRowsAtomFamily(key))
                const query = get(tableRowsQueryAtomFamily(key))
                const apiRows = query.data?.rows

                if (!apiRows) {
                    return skeletonRows
                }

                if (!apiRows.length) {
                    return []
                }

                return skeletonRows.slice(0, apiRows.length).map((skeleton, index) => {
                    const apiRow = apiRows[index]
                    return options.mergeRow({skeleton, apiRow})
                })
            }),
        rowsKeyEquals,
    )

    const tablePagesAtomFamily = atomFamily(({scopeId, pageSize}: TablePagesKey) => {
        const baseAtom = atom<{pages: InfiniteTablePage[]}>({
            pages: [
                {
                    offset: 0,
                    limit: pageSize,
                    cursor: null,
                    windowing: null,
                },
            ],
        })

        return atom(
            (get) => get(baseAtom),
            (
                get,
                set,
                update:
                    | {pages: InfiniteTablePage[]}
                    | ((prev: {pages: InfiniteTablePage[]}) => {pages: InfiniteTablePage[]}),
            ) => {
                const nextValue = typeof update === "function" ? update(get(baseAtom)) : update
                set(baseAtom, nextValue)
            },
        )
    }, pagesKeyEquals)

    const tableCombinedRowsAtomFamily = atomFamily(
        ({scopeId, pageSize}: TablePagesKey) =>
            atom((get) => {
                const pagesState = get(tablePagesAtomFamily({scopeId, pageSize}))
                const combined: TableRow[] = []
                pagesState.pages.forEach(({offset, limit, cursor, windowing}) => {
                    const rows = get(
                        tableRowsAtomFamily({scopeId, offset, limit, cursor, windowing}),
                    )
                    combined.push(...rows)
                })
                return combined
            }),
        pagesKeyEquals,
    )

    const tablePaginationInfoAtomFamily = atomFamily(
        ({scopeId, pageSize}: TablePagesKey) =>
            atom((get) => {
                const pagesState = get(tablePagesAtomFamily({scopeId, pageSize}))
                const lastPage = pagesState.pages[pagesState.pages.length - 1]
                if (!lastPage) {
                    return {
                        hasMore: false,
                        nextCursor: null as string | null,
                        nextOffset: null as number | null,
                        isFetching: false,
                        totalCount: null as number | null,
                        nextWindowing: null as WindowingState | null,
                    }
                }
                const query = get(
                    tableRowsQueryAtomFamily({
                        scopeId,
                        cursor: lastPage.cursor,
                        limit: lastPage.limit,
                        offset: lastPage.offset,
                        windowing: lastPage.windowing ?? undefined,
                    }),
                )
                const data = query.data
                return {
                    hasMore: Boolean(data?.hasMore),
                    nextCursor: data?.nextCursor ?? null,
                    nextOffset: data?.nextOffset ?? null,
                    isFetching: Boolean(query.isFetching || query.isPending),
                    totalCount: data?.totalCount ?? null,
                    nextWindowing: data?.nextWindowing ?? null,
                }
            }),
        pagesKeyEquals,
    )

    const createInitialPage = (pageSize: number): InfiniteTablePage => ({
        offset: 0,
        limit: pageSize,
        cursor: null,
        windowing: null,
    })

    const tableScheduleNextPageAtomFamily = atomFamily(
        ({scopeId, pageSize}: TablePagesKey) =>
            atom<null, [ScheduleWriteArg], void>(null, (get, set, params) => {
                if (!params) return
                set(tablePagesAtomFamily({scopeId, pageSize}), (prev) => {
                    if (
                        prev.pages.some(
                            (page) =>
                                page.cursor === params.nextCursor &&
                                (page.windowing?.next ?? null) ===
                                    (params.nextWindowing?.next ?? params.nextCursor),
                        )
                    ) {
                        return prev
                    }
                    return {
                        pages: [
                            ...prev.pages,
                            {
                                offset: params.nextOffset,
                                limit: pageSize,
                                cursor: params.nextCursor,
                                windowing: params.nextWindowing,
                            },
                        ],
                    }
                })
            }),
        pagesKeyEquals,
    )

    return {
        key: options.key,
        atoms: {
            pagesAtomFamily: tablePagesAtomFamily,
            scheduleNextPageAtomFamily: tableScheduleNextPageAtomFamily,
            combinedRowsAtomFamily: tableCombinedRowsAtomFamily,
            paginationInfoAtomFamily: tablePaginationInfoAtomFamily,
            rowsAtomFamily: tableRowsAtomFamily,
            rowsQueryAtomFamily: tableRowsQueryAtomFamily,
        },
        createInitialPage,
    }
}
