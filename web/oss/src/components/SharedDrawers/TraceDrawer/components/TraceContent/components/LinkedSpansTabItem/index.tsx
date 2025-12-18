import {useCallback, useMemo} from "react"

import {Tag, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import EnhancedTable from "@/oss/components/EnhancedUIs/Table"
import {getObservabilityColumns} from "@/oss/components/pages/observability/assets/getObservabilityColumns"
import {
    LinkedSpanRow,
    linkedSpansAtom,
    linkedSpanTargetsAtom,
    linkedSpanTracesQueryAtom,
    setTraceDrawerTraceAtom,
} from "@/oss/components/SharedDrawers/TraceDrawer/store/traceDrawerStore"
import TooltipWithCopyAction from "@/oss/components/TooltipWithCopyAction"
import {TraceSpanNode} from "@/oss/services/tracing/types"
import {useQueryParamState} from "@/oss/state/appState"

interface LinkedSpansTabItemProps {
    isActive: boolean
}

const collectEvaluatorSlugsFromTraces = (traces: TraceSpanNode[]) => {
    const slugs = new Set<string>()

    const visit = (node?: TraceSpanNode) => {
        if (!node) return

        const metrics = (node as TraceSpanNode & {aggregatedEvaluatorMetrics?: Record<string, any>})
            ?.aggregatedEvaluatorMetrics
        if (metrics && typeof metrics === "object") {
            Object.keys(metrics).forEach((slug) => {
                if (slug) {
                    slugs.add(slug)
                }
            })
        }

        const children = (node as TraceSpanNode & {children?: TraceSpanNode[]})?.children
        if (Array.isArray(children)) {
            children.forEach((child) => visit(child as TraceSpanNode))
        }
    }

    traces.forEach((trace) => visit(trace))

    return Array.from(slugs)
}

const LinkedSpansTabItem = ({isActive: _isActive}: LinkedSpansTabItemProps) => {
    const linkTargets = useAtomValue(linkedSpanTargetsAtom)
    const linkedSpans = useAtomValue(linkedSpansAtom)
    const linkedSpansQuery = useAtomValue(linkedSpanTracesQueryAtom)
    const setTraceDrawerTrace = useSetAtom(setTraceDrawerTraceAtom)
    const [, setTraceParam] = useQueryParamState("trace")
    const [, setSpanParam] = useQueryParamState("span")

    const evaluatorSlugs = useMemo(
        () => collectEvaluatorSlugsFromTraces(linkedSpans),
        [linkedSpans],
    )

    const baseColumns = useMemo(() => getObservabilityColumns({evaluatorSlugs}), [evaluatorSlugs])

    const navigateToLink = useCallback(
        (record: LinkedSpanRow) => {
            setTraceDrawerTrace({
                traceId: record.trace_id,
                activeSpanId: record.span_id,
                source: "linked",
            })
            setTraceParam(record.trace_id, {shallow: true})
            setSpanParam(record.span_id, {shallow: true})
        },
        [setSpanParam, setTraceDrawerTrace, setTraceParam],
    )

    const filteredColumns = useMemo(() => {
        const idColumn = {
            title: "ID",
            key: "id",
            dataIndex: ["span_id"],
            width: 200,
            fixed: "left",
            onHeaderCell: () => ({
                style: {minWidth: 200},
            }),
            render: (_, record) => {
                const spanId = record.span_id || ""
                const shortId = spanId ? spanId.split("-")[0] : "-"
                return (
                    <TooltipWithCopyAction copyText={spanId} title="Copy span id">
                        <Tag
                            bordered={false}
                            className="font-mono bg-[#0517290F]"
                            onClick={() => navigateToLink(record)}
                        >
                            # {shortId}
                        </Tag>
                    </TooltipWithCopyAction>
                )
            },
        }
        const filtered = baseColumns.filter(
            (column) =>
                !["name", "span_type", "evaluators"].includes(String(column.key)) &&
                !(Array.isArray(column.children) && column.children.length > 0) &&
                column.title !== "ID",
        )
        return [idColumn, ...filtered]
    }, [baseColumns])

    const loading = linkedSpansQuery.isFetching || linkedSpansQuery.isLoading
    const hasLinks = linkTargets.length > 0

    if (!hasLinks) {
        return (
            <div className="flex items-center justify-center">
                <Typography.Text type="secondary">No linked spans found.</Typography.Text>
            </div>
        )
    }

    return (
        <EnhancedTable
            loading={loading}
            rowKey={(record) => record.key || `${record.trace_id}-${record.span_id}`}
            columns={filteredColumns}
            dataSource={linkedSpans}
            scroll={{x: "max-content"}}
            uniqueKey="trace-drawer-linked-spans"
            onRow={(record) => ({
                onClick: () => {
                    navigateToLink(record)
                },
            })}
        />
    )
}

export default LinkedSpansTabItem
