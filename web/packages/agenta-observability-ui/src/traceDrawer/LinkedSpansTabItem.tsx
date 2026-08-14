import {useCallback, useMemo} from "react"

import {
    LinkedSpanRow,
    linkedSpansAtom,
    linkedSpanTargetsAtom,
    linkedSpanTracesQueryAtom,
    setTraceDrawerTraceAtom,
} from "@agenta/observability/traceDrawer"
import {traceDrawerSetQueryParam} from "@agenta/observability/traceDrawer"
import {Tag} from "@agenta/ui/components/presentational"
import {CopyTooltip as EnhancedTooltip} from "@agenta/ui/copy-tooltip"
import {InfiniteVirtualTable} from "@agenta/ui/table"
import type {InfiniteTableRowBase} from "@agenta/ui/table"
import type {ColumnDefs} from "@agenta/ui/table"
import {useAtomValue, useSetAtom} from "jotai"

import {getObservabilityColumns} from "@agenta/observability-ui"

interface LinkedSpansTabItemProps {
    isActive: boolean
}

type LinkedSpanTableRow = LinkedSpanRow & InfiniteTableRowBase

interface TraceWithEvaluatorMetrics {
    aggregatedEvaluatorMetrics?: Record<string, unknown> | null
    children?: TraceWithEvaluatorMetrics[]
}

const collectEvaluatorSlugsFromTraces = (traces: TraceWithEvaluatorMetrics[]) => {
    const slugs = new Set<string>()

    const visit = (node?: TraceWithEvaluatorMetrics) => {
        if (!node) return

        const metrics = node.aggregatedEvaluatorMetrics
        if (metrics && typeof metrics === "object") {
            Object.keys(metrics).forEach((slug) => {
                if (slug) {
                    slugs.add(slug)
                }
            })
        }

        const children = node.children
        if (Array.isArray(children)) {
            children.forEach((child) => visit(child))
        }
    }

    traces.forEach((trace) => visit(trace))

    return Array.from(slugs)
}

const LinkedSpansTabItem = ({isActive}: LinkedSpansTabItemProps) => {
    const linkTargets = useAtomValue(linkedSpanTargetsAtom)
    const linkedSpans = useAtomValue(linkedSpansAtom)
    const linkedSpansQuery = useAtomValue(linkedSpanTracesQueryAtom)
    const setTraceDrawerTrace = useSetAtom(setTraceDrawerTraceAtom)
    const setTraceParam = (value: string | null | undefined) =>
        traceDrawerSetQueryParam("trace", value)
    const setSpanParam = (value: string | null | undefined) =>
        traceDrawerSetQueryParam("span", value)

    const evaluatorSlugs = useMemo(
        () => collectEvaluatorSlugsFromTraces(linkedSpans),
        [linkedSpans],
    )

    const baseColumns = useMemo<ColumnDefs<LinkedSpanTableRow>>(
        () => getObservabilityColumns({evaluatorSlugs}) as ColumnDefs<LinkedSpanTableRow>,
        [evaluatorSlugs],
    )

    const navigateToLink = useCallback(
        (record: LinkedSpanRow) => {
            setTraceDrawerTrace({
                traceId: record.trace_id,
                activeSpanId: record.span_id,
                source: "linked",
            })
            // The seam always writes shallow; the old antd-era options arg is gone.
            setTraceParam(record.trace_id)
            setSpanParam(record.span_id)
        },
        [setSpanParam, setTraceDrawerTrace, setTraceParam],
    )

    const tableRows = useMemo<LinkedSpanTableRow[]>(
        () =>
            linkedSpans.map((linkedSpan) => ({
                ...linkedSpan,
                key: linkedSpan.key || `${linkedSpan.trace_id}-${linkedSpan.span_id}`,
                __isSkeleton: false,
            })),
        [linkedSpans],
    )

    const filteredColumns = useMemo<ColumnDefs<LinkedSpanTableRow>>(() => {
        const idColumn: ColumnDefs<LinkedSpanTableRow>[number] = {
            title: "ID",
            key: "id",
            dataIndex: ["span_id"],
            width: 200,
            fixed: "left",
            onHeaderCell: () => ({
                style: {minWidth: 200},
            }),
            render: (_: unknown, record: LinkedSpanTableRow) => {
                const spanId = record.span_id || ""
                const shortId = spanId ? spanId.split("-")[0] : "-"
                return (
                    <EnhancedTooltip copyText={spanId} title="Copy span id">
                        <Tag
                            className="font-mono bg-[var(--ag-c-0517290F)]"
                            onClick={() => navigateToLink(record)}
                            label={`# ${shortId}`}
                        />
                    </EnhancedTooltip>
                )
            },
        }
        const filtered = baseColumns.filter(
            (column) =>
                !["name", "span_type", "evaluators"].includes(String(column.key)) &&
                !(
                    "children" in column &&
                    Array.isArray(column.children) &&
                    column.children.length > 0
                ) &&
                column.title !== "ID",
        )
        return [idColumn, ...filtered]
    }, [baseColumns, navigateToLink])

    const loadMore = useCallback(() => {}, [])

    const loading = linkedSpansQuery.isFetching || linkedSpansQuery.isLoading
    const hasLinks = linkTargets.length > 0

    if (!hasLinks) {
        return (
            <div className="flex items-center justify-center">
                <span className="text-colorTextSecondary">No linked spans found.</span>
            </div>
        )
    }

    return (
        <div className="h-full min-h-0">
            <InfiniteVirtualTable<LinkedSpanTableRow>
                active={isActive}
                scopeId="trace-drawer-linked-spans"
                columns={filteredColumns}
                dataSource={tableRows}
                loadMore={loadMore}
                rowKey={(record) => record.key || `${record.trace_id}-${record.span_id}`}
                containerClassName="h-full min-h-0"
                tableProps={{
                    bordered: true,
                    loading,
                    onRow: (record) => ({
                        onClick: () => {
                            navigateToLink(record)
                        },
                    }),
                }}
            />
        </div>
    )
}

export default LinkedSpansTabItem
