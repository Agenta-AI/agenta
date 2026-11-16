import type {ReactNode} from "react"
import {useMemo} from "react"

import {useSessions} from "@agenta/observability"
import {
    InfiniteVirtualTableFeatureShell,
    type InfiniteVirtualTableFeatureProps,
    type TableFeaturePagination,
    type TableScopeConfig,
} from "@agenta/ui/table"
import {useStore} from "jotai"

import {useSessionColumns, type SessionRow} from "../columns/getSessionColumns"

/**
 * The observability sessions table.
 *
 * This owns the columns, the row shape derived from `useSessions`, and paging, and forwards
 * everything else.
 */
export interface ObservabilitySessionsTableProps extends Omit<
    InfiniteVirtualTableFeatureProps<SessionRow>,
    "columns" | "rowKey" | "tableScope" | "pagination" | "dataSource"
> {
    /** Replaces the table while the first page is in flight. */
    loadingState?: ReactNode
    /** Rendered inside the table, under the header, when there are no rows. */
    emptyState?: ReactNode
    onRowClick?: (record: SessionRow) => void
    tableScope?: Partial<TableScopeConfig>
}

const DEFAULT_PAGE_SIZE = 50

export const ObservabilitySessionsTable = ({
    loadingState,
    emptyState,
    onRowClick,
    tableScope,
    tableProps,
    store,
    ...featureProps
}: ObservabilitySessionsTableProps) => {
    const {
        isLoading,
        sessionIds,
        sessionCount,
        fetchMoreSessions,
        hasMoreSessions,
        isFetchingMore,
        resetSessionPages,
    } = useSessions()

    // The cells read page-level atoms; an isolated store leaves them empty.
    const ambientStore = useStore()

    const columns = useSessionColumns()

    // The cells read their own data from atoms keyed by session id, so a row only carries the id.
    const rows = useMemo<SessionRow[]>(
        () => sessionIds.map((id) => ({key: id, session_id: id})),
        [sessionIds],
    )

    const scope = useMemo<TableScopeConfig>(
        () => ({
            scopeId: "sessions",
            pageSize: DEFAULT_PAGE_SIZE,
            columnVisibilityStorageKey: "observability-sessions-table-columns",
            ...tableScope,
        }),
        [tableScope],
    )

    const pagination = useMemo<TableFeaturePagination<SessionRow>>(
        () => ({
            rows,
            loadNextPage: () => fetchMoreSessions(),
            resetPages: resetSessionPages,
            paginationInfo: {
                hasMore: hasMoreSessions,
                nextCursor: null,
                nextOffset: null,
                isFetching: isFetchingMore,
                totalCount: sessionCount,
            },
        }),
        [rows, fetchMoreSessions, resetSessionPages, hasMoreSessions, isFetchingMore, sessionCount],
    )

    if (isLoading && rows.length === 0 && loadingState) return <>{loadingState}</>

    return (
        <InfiniteVirtualTableFeatureShell<SessionRow>
            {...featureProps}
            store={store ?? ambientStore}
            tableScope={scope}
            columns={columns}
            rowKey="session_id"
            pagination={pagination}
            tableProps={{
                // Part of this table's identity, not either app's: without them /m rendered
                // the same rows with no cell borders and a non-sticky header.
                bordered: true,
                sticky: true,
                ...tableProps,
                ...(emptyState ? {locale: {...tableProps?.locale, emptyText: emptyState}} : {}),
                ...(onRowClick
                    ? {
                          onRow: (record: SessionRow, index?: number) => ({
                              ...tableProps?.onRow?.(record, index),
                              onClick: () => onRowClick(record),
                          }),
                      }
                    : {}),
            }}
        />
    )
}

export default ObservabilitySessionsTable
