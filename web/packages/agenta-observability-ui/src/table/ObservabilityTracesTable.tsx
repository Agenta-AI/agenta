import type {ReactNode} from "react"
import {useMemo} from "react"

import {useObservability} from "@agenta/observability"
import {VirtualTable} from "@agenta/ui/table"

import {getObservabilityColumns} from "../columns/getObservabilityColumns"
import type {TraceRow as ObservabilityTraceRow} from "../columns/getObservabilityColumns"

/**
 * The traces table both surfaces render.
 *
 * `/m` and web/oss drew the same data through two different shells, which is how they drifted:
 * the same change had to be made twice, and usually was not. They can share one component now
 * that the render leaf is antd-free — `InfiniteVirtualTable` still imports antd for its antd
 * branch, so this deliberately renders `VirtualTable` directly rather than going through it.
 *
 * State comes from `useObservability`, which both apps already used, so a consumer only places
 * the table and supplies what is genuinely app-specific: how tall it is, what a row click does,
 * and what to show while loading or when empty.
 */
export interface ObservabilityTracesTableProps {
    /** Body height. Without it the table fills its flex parent. */
    height?: number
    /** Rows are measured after mount, so this only needs to be close. */
    rowHeight?: number
    /** Evaluator columns to append, when the surface shows annotations. */
    evaluatorSlugs?: string[]
    /** Shown instead of rows while the first page is in flight. */
    loadingState?: ReactNode
    /** Shown inside the table, under the header, when there are no rows. */
    emptyState?: ReactNode
    onRowClick?: (record: ObservabilityTraceRow) => void
    className?: string
}

/** Desktop renders ~128px rows; the windowing measures, so this is only the first guess. */
const DEFAULT_ROW_HEIGHT = 128

export const ObservabilityTracesTable = ({
    height,
    rowHeight = DEFAULT_ROW_HEIGHT,
    evaluatorSlugs,
    loadingState,
    emptyState,
    onRowClick,
    className,
}: ObservabilityTracesTableProps) => {
    const {traces, isLoading, fetchMoreTraces, hasMoreTraces} = useObservability()

    const slugs = useMemo(() => evaluatorSlugs ?? [], [evaluatorSlugs])
    const columns = useMemo(() => getObservabilityColumns({evaluatorSlugs: slugs}), [slugs])

    if (isLoading && traces.length === 0 && loadingState) return <>{loadingState}</>

    return (
        <VirtualTable<ObservabilityTraceRow>
            className={className}
            columns={columns}
            dataSource={traces as ObservabilityTraceRow[]}
            rowKey={(row, index) => row.key ?? row.span_id ?? index}
            rowHeight={rowHeight}
            height={height}
            autoLayout
            emptyText={emptyState}
            // The table owns bottom-detection; consumers used to hand-roll this in onScroll.
            loadMore={hasMoreTraces ? fetchMoreTraces : undefined}
            onRow={
                onRowClick
                    ? (record) => ({
                          onClick: () => onRowClick(record),
                          className: "cursor-pointer",
                      })
                    : undefined
            }
        />
    )
}

export default ObservabilityTracesTable
