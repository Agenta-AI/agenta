import type {ReactNode} from "react"
import {useMemo} from "react"

import {useObservability} from "@agenta/observability"
import {
    InfiniteVirtualTableFeatureShell,
    type InfiniteVirtualTableFeatureProps,
    type TableFeaturePagination,
    type TableScopeConfig,
} from "@agenta/ui/table"

import {
    getDefaultHiddenObservabilityColumnKeys,
    getObservabilityColumns,
} from "../columns/getObservabilityColumns"
import type {TraceRow} from "../columns/getObservabilityColumns"

/**
 * The traces table both surfaces render.
 *
 * `/m` and web/oss drew the same rows through two different shells, which is how they drifted:
 * the same change had to be made twice, and usually was not. They share this one now that
 * @agenta/ui is runtime antd-free, so `/m` can render the FULL shell — paging,
 * column-visibility persistence, row selection — instead of a reduced copy of it.
 *
 * What this owns is what both surfaces agree on: the columns, the row key, and paging driven
 * by `useObservability`. Everything else is forwarded, so a surface can bring its own
 * selection, scope or toolbar without a second implementation growing back.
 */
export interface ObservabilityTracesTableProps extends Omit<
    InfiniteVirtualTableFeatureProps<TraceRow>,
    "columns" | "rowKey" | "tableScope" | "pagination"
> {
    /** Evaluator columns to append, when the surface shows annotations. */
    evaluatorSlugs?: string[]
    /** Replaces the table while the first page is in flight. */
    loadingState?: ReactNode
    /** Rendered inside the table, under the header, when there are no rows. */
    emptyState?: ReactNode
    onRowClick?: (record: TraceRow) => void
    /** Overrides the default scope, e.g. to persist column visibility under another key. */
    tableScope?: Partial<TableScopeConfig>
}

const DEFAULT_SCOPE_KEY = "observability-table-columns"
const DEFAULT_PAGE_SIZE = 50

export const ObservabilityTracesTable = ({
    evaluatorSlugs,
    loadingState,
    emptyState,
    onRowClick,
    tableScope,
    tableProps,
    ...featureProps
}: ObservabilityTracesTableProps) => {
    const {
        traces,
        isLoading,
        fetchMoreTraces,
        resetTracePages,
        hasMoreTraces,
        isFetchingMore,
        traceCount,
    } = useObservability()

    const slugs = useMemo(() => evaluatorSlugs ?? [], [evaluatorSlugs])
    const columns = useMemo(() => getObservabilityColumns({evaluatorSlugs: slugs}), [slugs])

    const scope = useMemo<TableScopeConfig>(
        () => ({
            scopeId: "observability-traces-table",
            pageSize: DEFAULT_PAGE_SIZE,
            columnVisibilityStorageKey: DEFAULT_SCOPE_KEY,
            columnVisibilityDefaults: getDefaultHiddenObservabilityColumnKeys({
                evaluatorSlugs: slugs,
            }),
            ...tableScope,
        }),
        [tableScope, slugs],
    )

    // Paging comes from the same hook on both surfaces, so neither has to assemble it.
    const pagination = useMemo<TableFeaturePagination<TraceRow>>(
        () => ({
            rows: traces as TraceRow[],
            loadNextPage: () => fetchMoreTraces(),
            resetPages: resetTracePages,
            paginationInfo: {
                hasMore: hasMoreTraces,
                nextCursor: null,
                nextOffset: null,
                isFetching: isFetchingMore,
                totalCount: traceCount,
            },
        }),
        [traces, fetchMoreTraces, resetTracePages, hasMoreTraces, isFetchingMore, traceCount],
    )

    if (isLoading && traces.length === 0 && loadingState) return <>{loadingState}</>

    return (
        <InfiniteVirtualTableFeatureShell<TraceRow>
            {...featureProps}
            tableScope={scope}
            columns={columns}
            rowKey={(record) => record.span_id || record.key || ""}
            pagination={pagination}
            tableProps={{
                ...tableProps,
                ...(emptyState ? {locale: {...tableProps?.locale, emptyText: emptyState}} : {}),
                ...(onRowClick
                    ? {
                          onRow: (record: TraceRow, index?: number) => ({
                              ...tableProps?.onRow?.(record, index),
                              onClick: () => onRowClick(record),
                          }),
                      }
                    : {}),
            }}
        />
    )
}

export default ObservabilityTracesTable
