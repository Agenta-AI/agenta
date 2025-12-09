import {useMemo} from "react"

import {Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import EnhancedTable from "@/oss/components/EnhancedUIs/Table"
import {EnhancedColumnType} from "@/oss/components/EnhancedUIs/Table/types"
import {
    LinkedSpanRow,
    linkedSpanTargetsAtom,
    linkedSpansAtom,
    linkedSpanTracesQueryAtom,
    setTraceDrawerTraceAtom,
} from "@/oss/components/Playground/Components/Drawers/TraceDrawer/store/traceDrawerStore"
import {getObservabilityColumns} from "@/oss/components/pages/observability/assets/getObservabilityColumns"
import {TraceSpanNode} from "@/oss/services/tracing/types"
import {useQueryParamState} from "@/oss/state/appState"

type LinkedSpansTabItemProps = {
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

const LinkedSpansTabItem = ({isActive}: LinkedSpansTabItemProps) => {
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

    const columns = useMemo(() => {
        const filtered = baseColumns.filter(
            (column) =>
                !["name", "span_type", "evaluators"].includes(String(column.key)) &&
                !(Array.isArray(column.children) && column.children.length > 0),
        )

        const sourceColumn: EnhancedColumnType<LinkedSpanRow> = {
            title: "Source",
            key: "source",
            dataIndex: ["linkSource"],
            width: 100,
            render: (_, record) => {
                return (
                    <Typography.Text className="capitalize">
                        {record.linkSource || record.linkKey || "Unknown"}
                    </Typography.Text>
                )
            },
        }

        const idColumnIndex = filtered.findIndex((col) => col.title === "ID")
        if (idColumnIndex !== -1) {
            const [idColumn] = filtered.splice(idColumnIndex, 1)
            return [idColumn, sourceColumn, ...filtered]
        }

        return [sourceColumn, ...filtered]
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
            columns={columns}
            dataSource={linkedSpans}
            scroll={{x: "max-content"}}
            uniqueKey="trace-drawer-linked-spans"
            onRow={(record) => ({
                onClick: () => {
                    setTraceDrawerTrace({
                        traceId: record.trace_id,
                        activeSpanId: record.span_id,
                        source: "linked",
                    })
                    setTraceParam(record.trace_id, {shallow: true})
                    setSpanParam(record.span_id, {shallow: true})
                },
            })}
        />
    )
}

export default LinkedSpansTabItem
