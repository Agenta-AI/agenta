import type {Key} from "react"

import type {CatalogKey} from "@agenta/i18n"
import columnsCatalog from "@agenta/i18n/catalogs/observabilityUi.columns"
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
import {ONE_LINE_CELL, ONE_LINE_MESSAGE_CELL} from "../cells/oneLineCell"
import {SpanIdChip} from "../cells/SpanIdChip"
import {SpanNameCell} from "../cells/SpanNameCell"
import {StatusRenderer} from "../cells/StatusRenderer"
import {TimestampCell} from "../cells/TimestampCell"
import {UsageCell} from "../cells/UsageCell"

type ColumnsKey = CatalogKey<typeof columnsCatalog>
type ColumnLabel = ColumnsKey extends `observabilityUi.columns.${infer Name}` ? Name : never

interface ObservabilityColumnsProps {
    evaluatorSlugs: string[]
    /**
     * Translates the column titles. Without it the titles are English: the CSV export matches
     * its headers to these titles, so it must not pass one.
     */
    t?: (key: ColumnsKey) => string
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

export const getObservabilityColumns = ({evaluatorSlugs, t}: ObservabilityColumnsProps) => {
    const label = (name: ColumnLabel): string =>
        t ? t(`observabilityUi.columns.${name}`) : columnsCatalog.en[name]
    const columns: ObservabilityColumn[] = [
        {
            title: label("id"),
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
                const shortId = spanId ? spanId.split("-")[0] : "—"
                return (
                    <TooltipWithCopyAction copyText={spanId || ""} title={label("copySpanId")}>
                        <SpanIdChip id={shortId} />
                    </TooltipWithCopyAction>
                )
            },
        },
        {
            title: label("name"),
            dataIndex: ["span_name"],
            key: "name",
            ellipsis: true,
            width: 132,
            onHeaderCell: () => ({
                style: {minWidth: 132},
            }),
            onCell: () => ({
                style: {verticalAlign: "middle"},
            }),
            fixed: "left",
            render: (_, record) => (
                <SpanNameCell
                    name={record.span_name}
                    type={record.span_type}
                    references={record.references}
                />
            ),
        },
        {
            title: label("spanType"),
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
            title: label("inputs"),
            key: "inputs",
            width: 140,
            render: (_, record) => {
                const inputs = getTraceInputs(record)
                const {data: sanitizedInputs} = sanitizeDataWithBlobUrls(inputs)
                return (
                    <LastInputMessageCell
                        value={sanitizedInputs}
                        keyPrefix={`trace-input-${record.span_id}`}
                        maxLines={1}
                        className={ONE_LINE_MESSAGE_CELL}
                    />
                )
            },
        },
        {
            title: label("outputs"),
            key: "outputs",
            width: 140,
            render: (_, record) => {
                const outputs = getTraceOutputs(record)
                const exception = record.events?.find((event) => event.name === "exception")
                const {data: sanitizedOutputs} = sanitizeDataWithBlobUrls(outputs)

                if (!outputs && exception) {
                    const exceptionMessage =
                        (exception.attributes?.["exception.message"] as string) ||
                        (exception.attributes?.["exception.type"] as string) ||
                        label("exception")
                    return (
                        <SmartCellContent
                            value={exceptionMessage}
                            keyPrefix={`trace-output-${record.span_id}`}
                            maxLines={1}
                            chatPreference="output"
                            // The Status column marks the error; the text stays neutral (LOUD-04).
                            className={`${ONE_LINE_CELL} text-muted-foreground`}
                        />
                    )
                }

                return (
                    <SmartCellContent
                        value={sanitizedOutputs}
                        keyPrefix={`trace-output-${record.span_id}`}
                        maxLines={1}
                        chatPreference="output"
                        className={ONE_LINE_CELL}
                    />
                )
            },
        },
        ...(evaluatorSlugs.length > 0
            ? [
                  {
                      title: label("evaluators"),
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
            title: label("duration"),
            key: "duration",
            dataIndex: ["time", "span"],
            width: 64,
            onHeaderCell: () => ({
                style: {minWidth: 64},
            }),
            render: (_, record) => {
                const duration = getLatency(record)
                return <DurationCell ms={duration ?? undefined} />
            },
        },
        {
            title: label("cost"),
            key: "cost",
            dataIndex: ["attributes", "ag", "metrics", "costs", "cumulative", "total"],
            width: 80,
            onHeaderCell: () => ({
                style: {minWidth: 80},
            }),
            render: (_, record) => {
                const cost = getCost(record)
                return <CostCell cost={cost ?? undefined} />
            },
        },
        {
            title: label("usage"),
            key: "usage",
            dataIndex: ["attributes", "ag", "metrics", "tokens", "cumulative", "total"],
            width: 72,
            // Off by default so the default columns fit a 1280 screen; Edit columns adds it.
            defaultHidden: true,
            onHeaderCell: () => ({
                style: {minWidth: 72},
            }),
            render: (_, record) => {
                const tokens = getTokens(record)
                return <UsageCell tokens={tokens ?? undefined} />
            },
        },
        {
            title: label("timestamp"),
            key: "timestamp",
            dataIndex: ["created_at"],
            width: 164,
            onHeaderCell: () => ({
                style: {minWidth: 164},
            }),
            render: (_, record) => <TimestampCell timestamp={record?.created_at} />,
        },
        {
            title: label("status"),
            key: "status",
            dataIndex: ["status_code"],
            width: 84,
            onHeaderCell: () => ({
                style: {minWidth: 84},
            }),
            render: (_, record) => (
                <StatusRenderer
                    status={record.status_code}
                    message={record.status_message}
                    showMore
                />
            ),
        },
        {
            title: <ColumnVisibilityMenuTrigger variant="icon" label={label("editColumns")} />,
            key: "actions",
            width: 44,
            fixed: "right",
            align: "center",
            columnVisibilityLocked: true,
            exportEnabled: false,
            onHeaderCell: () => ({
                style: {minWidth: 44},
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
