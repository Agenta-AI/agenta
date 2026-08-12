import type {Key} from "react"

import {
    getCost,
    getLatency,
    getTokens,
    getTraceInputs,
    getTraceOutputs,
} from "@agenta/observability"
import type {TraceSpanNode} from "@agenta/observability"
import {sanitizeDataWithBlobUrls} from "@agenta/shared/utils"
import {LastInputMessageCell, SmartCellContent} from "@agenta/ui/cell-renderers"
import {CopyTooltip as TooltipWithCopyAction} from "@agenta/ui/copy-tooltip"
import {ColumnVisibilityMenuTrigger, type ColumnDefs, type ExtendedColumn} from "@agenta/ui/table"

import {CostCell} from "../cells/CostCell"
import {DurationCell} from "../cells/DurationCell"
import EvaluatorMetricsCell from "../cells/EvaluatorMetricsCell"
import {NodeNameCell} from "../cells/NodeNameCell"
import {SpanIdChip} from "../cells/SpanIdChip"
import {StatusRenderer} from "../cells/StatusRenderer"
import {TimestampCell} from "../cells/TimestampCell"
import {UsageCell} from "../cells/UsageCell"

interface ObservabilityColumnsProps {
    evaluatorSlugs: string[]
}

// Row alias: TraceSpanNode lacks the required key + index signature of InfiniteTableRowBase.
export type TraceRow = TraceSpanNode & {key: Key; [key: string]: unknown}

// Table column extended with props consumed by the InfiniteVirtualTable layer.
type ObservabilityColumn = ExtendedColumn<TraceRow>

const collectDefaultHiddenColumnKeys = <T,>(columns: ColumnDefs<T>): string[] => {
    const hiddenKeys = new Set<string>()

    const visit = (cols: ColumnDefs<T>) => {
        cols.forEach((column) => {
            const key = column.key != null ? String(column.key) : null
            if (key && (column as {defaultHidden?: boolean}).defaultHidden) {
                hiddenKeys.add(key)
            }

            if ("children" in column && Array.isArray(column.children)) {
                visit(column.children)
            }
        })
    }

    visit(columns)
    return Array.from(hiddenKeys)
}

export const getObservabilityColumns = ({evaluatorSlugs}: ObservabilityColumnsProps) => {
    const columns: ObservabilityColumn[] = [
        {
            title: "ID",
            dataIndex: ["span_id"],
            key: "key",
            width: 200,
            onHeaderCell: () => ({
                style: {minWidth: 200},
            }),
            defaultHidden: true,
            fixed: "left",
            render: (_, record) => {
                const spanId = record.span_id || ""
                const shortId = spanId ? spanId.split("-")[0] : "-"
                return (
                    <TooltipWithCopyAction copyText={spanId || ""} title="Copy span id">
                        <SpanIdChip id={shortId} />
                    </TooltipWithCopyAction>
                )
            },
        },
        {
            title: "Name",
            dataIndex: ["span_name"],
            key: "name",
            ellipsis: true,
            width: 200,
            onHeaderCell: () => ({
                style: {minWidth: 200},
            }),
            onCell: () => ({
                style: {verticalAlign: "middle"},
            }),
            fixed: "left",
            render: (_, record) => <NodeNameCell name={record.span_name} type={record.span_type} />,
        },
        {
            title: "Span type",
            key: "span_type",
            dataIndex: ["span_type"],
            defaultHidden: true,
            width: 200,
            onHeaderCell: () => ({
                style: {minWidth: 200},
            }),
            render: (_, record) => {
                return <div>{record.span_type}</div>
            },
        },
        {
            title: "Inputs",
            key: "inputs",
            width: 400,
            maxWidth: 400,
            render: (_, record) => {
                const inputs = getTraceInputs(record)
                const {data: sanitizedInputs} = sanitizeDataWithBlobUrls(inputs)
                return (
                    <LastInputMessageCell
                        value={sanitizedInputs}
                        keyPrefix={`trace-input-${record.span_id}`}
                        className="h-[112px] overflow-hidden"
                    />
                )
            },
        },
        {
            title: "Outputs",
            key: "outputs",
            width: 400,
            maxWidth: 400,
            render: (_, record) => {
                const outputs = getTraceOutputs(record)
                const exception = record.events?.find((event) => event.name === "exception")
                const {data: sanitizedOutputs} = sanitizeDataWithBlobUrls(outputs)

                if (!outputs && exception) {
                    const exceptionMessage =
                        (exception.attributes?.["exception.message"] as string) ||
                        (exception.attributes?.["exception.type"] as string) ||
                        "Exception"
                    return (
                        <SmartCellContent
                            value={exceptionMessage}
                            keyPrefix={`trace-output-${record.span_id}`}
                            maxLines={4}
                            chatPreference="output"
                            className="h-[112px] overflow-hidden text-red-500"
                        />
                    )
                }

                return (
                    <SmartCellContent
                        value={sanitizedOutputs}
                        keyPrefix={`trace-output-${record.span_id}`}
                        maxLines={4}
                        chatPreference="output"
                        className="h-[112px] overflow-hidden"
                    />
                )
            },
        },
        ...(evaluatorSlugs.length > 0
            ? [
                  {
                      title: "Evaluators",
                      key: "evaluators",
                      align: "start" as const,
                      children: evaluatorSlugs.map((evaluatorSlug) => ({
                          title: null,
                          key: evaluatorSlug,
                          onHeaderCell: () => ({style: {display: "none"}}),
                          render: (_: unknown, record: TraceSpanNode) => (
                              <EvaluatorMetricsCell
                                  invocationKey={`${record.invocationIds?.trace_id || ""}:${record.invocationIds?.span_id || ""}`}
                                  evaluatorSlug={evaluatorSlug}
                              />
                          ),
                      })),
                  },
              ]
            : []),
        {
            title: "Duration",
            key: "duration",
            dataIndex: ["time", "span"],
            width: 150,
            onHeaderCell: () => ({
                style: {minWidth: 150},
            }),
            render: (_, record) => {
                const duration = getLatency(record)
                return <DurationCell ms={duration ?? undefined} />
            },
        },
        {
            title: "Cost",
            key: "cost",
            dataIndex: ["attributes", "ag", "metrics", "costs", "cumulative", "total"],
            width: 150,
            onHeaderCell: () => ({
                style: {minWidth: 150},
            }),
            render: (_, record) => {
                const cost = getCost(record)
                return <CostCell cost={cost ?? undefined} />
            },
        },
        {
            title: "Usage",
            key: "usage",
            dataIndex: ["attributes", "ag", "metrics", "tokens", "cumulative", "total"],
            width: 150,
            onHeaderCell: () => ({
                style: {minWidth: 150},
            }),
            render: (_, record) => {
                const tokens = getTokens(record)
                return <UsageCell tokens={tokens ?? undefined} />
            },
        },
        {
            title: "Timestamp",
            key: "timestamp",
            dataIndex: ["created_at"],
            width: 200,
            onHeaderCell: () => ({
                style: {minWidth: 200},
            }),
            render: (_, record) => <TimestampCell timestamp={record?.created_at} />,
        },
        {
            title: "Status",
            key: "status",
            dataIndex: ["status_code"],
            width: 160,
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_, record) =>
                StatusRenderer({
                    status: record.status_code,
                    message: record.status_message,
                    showMore: true,
                }),
        },
        {
            title: <ColumnVisibilityMenuTrigger variant="icon" label="Edit columns" />,
            key: "actions",
            width: 61,
            fixed: "right",
            align: "center",
            columnVisibilityLocked: true,
            exportEnabled: false,
            onHeaderCell: () => ({
                style: {minWidth: 56},
            }),
            render: () => null,
        },
    ]

    return columns
}

export const getDefaultHiddenObservabilityColumnKeys = ({
    evaluatorSlugs,
}: ObservabilityColumnsProps) =>
    collectDefaultHiddenColumnKeys(getObservabilityColumns({evaluatorSlugs}))
