import {SmartCellContent} from "@agenta/ui/cell-renderers"
import {CopyTooltip as TooltipWithCopyAction} from "@agenta/ui/copy-tooltip"
import {Tag} from "antd"

import {
    ColumnVisibilityMenuTrigger,
    createActionsCell,
    createComponentCell,
    createTableColumns,
    type InfiniteTableRowBase,
    type TableColumnConfig,
} from "@/oss/components/InfiniteVirtualTable"
import {sanitizeDataWithBlobUrls} from "@/oss/lib/helpers/utils"
import {TraceSpanNode} from "@/oss/services/tracing/types"
import {
    getCost,
    getLatency,
    getTokens,
    getTraceInputs,
    getTraceOutputs,
} from "@/oss/state/newObservability"

import LastInputMessageCell from "../components/common/LastInputMessageCell"
import CostCell from "../components/CostCell"
import DurationCell from "../components/DurationCell"
import EvaluatorMetricsCell from "../components/EvaluatorMetricsCell"
import NodeNameCell from "../components/NodeNameCell"
import ActionsCell from "../components/ObservabilityTable/components/ActionsCell"
import StatusRenderer from "../components/StatusRenderer"
import TimestampCell from "../components/TimestampCell"
import UsageCell from "../components/UsageCell"

export interface ObservabilityTraceRow extends TraceSpanNode, InfiniteTableRowBase {
    key: string
    __isSkeleton: false
}

interface ObservabilityColumnsProps {
    evaluatorSlugs: string[]
    onOpenTrace: (record: ObservabilityTraceRow) => void
    onDeleteTrace: (record: ObservabilityTraceRow) => void
    onAddToTestset: (record: ObservabilityTraceRow) => void
}

export const getObservabilityColumns = ({
    evaluatorSlugs,
    onOpenTrace,
    onDeleteTrace,
    onAddToTestset,
}: ObservabilityColumnsProps) => {
    const evaluatorColumns =
        evaluatorSlugs.length <= 1
            ? [
                  {
                      title: "Evaluators",
                      key: "evaluators",
                      width: 260,
                      minWidth: 240,
                      cell: createComponentCell<ObservabilityTraceRow>({
                          render: (record) =>
                              evaluatorSlugs[0] ? (
                                  <EvaluatorMetricsCell
                                      invocationKey={`${record.invocationIds?.trace_id || ""}:${record.invocationIds?.span_id || ""}`}
                                      evaluatorSlug={evaluatorSlugs[0]}
                                  />
                              ) : (
                                  <span className="text-gray-500">-</span>
                              ),
                      }),
                  } satisfies TableColumnConfig<ObservabilityTraceRow>,
              ]
            : [
                  {
                      title: "Evaluators",
                      key: "evaluators",
                      visibilityLabel: "Evaluators",
                      children: evaluatorSlugs.map((evaluatorSlug) => ({
                          title: evaluatorSlug,
                          key: evaluatorSlug,
                          width: 260,
                          minWidth: 240,
                          visibilityLabel: evaluatorSlug,
                          cell: createComponentCell<ObservabilityTraceRow>({
                              render: (record) => (
                                  <EvaluatorMetricsCell
                                      invocationKey={`${record.invocationIds?.trace_id || ""}:${record.invocationIds?.span_id || ""}`}
                                      evaluatorSlug={evaluatorSlug}
                                  />
                              ),
                          }),
                      })),
                  } satisfies TableColumnConfig<ObservabilityTraceRow>,
              ]

    const columns: TableColumnConfig<ObservabilityTraceRow>[] = [
        {
            title: "ID",
            key: "key",
            width: 200,
            minWidth: 200,
            defaultHidden: true,
            cell: createComponentCell<ObservabilityTraceRow>({
                render: (record) => {
                    const spanId = record.span_id || ""
                    const shortId = spanId ? spanId.split("-")[0] : "-"

                    return (
                        <TooltipWithCopyAction copyText={spanId} title="Copy span id">
                            <Tag className="font-mono bg-[#0517290F]" bordered={false}>
                                # {shortId}
                            </Tag>
                        </TooltipWithCopyAction>
                    )
                },
            }),
        },
        {
            title: "Name",
            key: "name",
            width: 200,
            minWidth: 200,
            ellipsis: true,
            fixed: "left",
            cell: createComponentCell<ObservabilityTraceRow>({
                render: (record) => (
                    <NodeNameCell name={record.span_name ?? ""} type={record.span_type} />
                ),
            }),
        },
        {
            title: "Span type",
            key: "span_type",
            width: 200,
            minWidth: 200,
            defaultHidden: true,
            cell: createComponentCell<ObservabilityTraceRow>({
                render: (record) => <div>{record.span_type ?? "-"}</div>,
            }),
        },
        {
            title: "Inputs",
            key: "inputs",
            width: 400,
            minWidth: 320,
            className: "overflow-hidden text-ellipsis whitespace-nowrap max-w-[400px]",
            cell: createComponentCell<ObservabilityTraceRow>({
                render: (record) => {
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
            }),
        },
        {
            title: "Outputs",
            key: "outputs",
            width: 400,
            minWidth: 320,
            className: "overflow-hidden text-ellipsis whitespace-nowrap max-w-[400px]",
            cell: createComponentCell<ObservabilityTraceRow>({
                render: (record) => {
                    const outputs = getTraceOutputs(record)
                    const {data: sanitizedOutputs} = sanitizeDataWithBlobUrls(outputs)

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
            }),
        },
        ...evaluatorColumns,
        {
            title: "Duration",
            key: "duration",
            width: 90,
            minWidth: 90,
            cell: createComponentCell<ObservabilityTraceRow>({
                render: (record) => <DurationCell ms={getLatency(record)} />,
            }),
        },
        {
            title: "Cost",
            key: "cost",
            width: 90,
            minWidth: 90,
            cell: createComponentCell<ObservabilityTraceRow>({
                render: (record) => <CostCell cost={getCost(record)} />,
            }),
        },
        {
            title: "Usage",
            key: "usage",
            width: 90,
            minWidth: 90,
            cell: createComponentCell<ObservabilityTraceRow>({
                render: (record) => <UsageCell tokens={getTokens(record)} />,
            }),
        },
        {
            title: "Timestamp",
            key: "timestamp",
            width: 200,
            minWidth: 200,
            cell: createComponentCell<ObservabilityTraceRow>({
                render: (record) => <TimestampCell timestamp={record.created_at} />,
            }),
        },
        {
            title: "Status",
            key: "status",
            width: 160,
            minWidth: 160,
            cell: createComponentCell<ObservabilityTraceRow>({
                render: (record) =>
                    StatusRenderer({
                        status: record.status_code,
                        message: record.status_message,
                        showMore: true,
                    }),
            }),
        },
        {
            title: <ColumnVisibilityMenuTrigger variant="icon" />,
            key: "actions",
            width: 61,
            minWidth: 56,
            fixed: "right",
            align: "center",
            visibilityLocked: true,
            exportEnabled: false,
            cell: createActionsCell<ObservabilityTraceRow>({
                render: (record) => (
                    <ActionsCell
                        record={record}
                        onOpenTrace={onOpenTrace}
                        onAddToTestset={onAddToTestset}
                        onDeleteTrace={onDeleteTrace}
                    />
                ),
            }),
        },
    ]

    return createTableColumns<ObservabilityTraceRow>(columns)
}
