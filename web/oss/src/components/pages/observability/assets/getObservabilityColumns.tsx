import {SmartCellContent} from "@agenta/ui/cell-renderers"
import {Tag} from "antd"
import {ColumnsType} from "antd/es/table"

import TooltipWithCopyAction from "@/oss/components/EnhancedUIs/Tooltip"
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
import StatusRenderer from "../components/StatusRenderer"
import TimestampCell from "../components/TimestampCell"
import UsageCell from "../components/UsageCell"

interface ObservabilityColumnsProps {
    evaluatorSlugs: string[]
}

export const getObservabilityColumns = ({evaluatorSlugs}: ObservabilityColumnsProps) => {
    const columns: ColumnsType<TraceSpanNode> = [
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
                        <Tag className="font-mono bg-[#0517290F]" bordered={false}>
                            # {shortId}
                        </Tag>
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
            className: "overflow-hidden text-ellipsis whitespace-nowrap max-w-[400px]",
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
            className: "overflow-hidden text-ellipsis whitespace-nowrap max-w-[400px]",
            render: (_, record) => {
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
        },
        {
            title: "Evaluators",
            key: "evaluators",
            align: "start",
            children: evaluatorSlugs.map((evaluatorSlug) => ({
                title: "",
                key: evaluatorSlug,
                onHeaderCell: () => ({
                    style: {display: "none"},
                }),
                render: (_, record) => (
                    <EvaluatorMetricsCell
                        invocationKey={`${record.invocationIds?.trace_id || ""}:${record.invocationIds?.span_id || ""}`}
                        evaluatorSlug={evaluatorSlug}
                    />
                ),
            })),
        },
        {
            title: "Duration",
            key: "duration",
            dataIndex: ["time", "span"],
            width: 90,
            onHeaderCell: () => ({
                style: {minWidth: 90},
            }),
            render: (_, record) => {
                const duration = getLatency(record)
                return <DurationCell ms={duration} />
            },
        },
        {
            title: "Cost",
            key: "cost",
            dataIndex: ["attributes", "ag", "metrics", "costs", "cumulative", "total"],
            width: 90,
            onHeaderCell: () => ({
                style: {minWidth: 90},
            }),
            render: (_, record) => {
                const cost = getCost(record)
                return <CostCell cost={cost} />
            },
        },
        {
            title: "Usage",
            key: "usage",
            dataIndex: ["attributes", "ag", "metrics", "tokens", "cumulative", "total"],
            width: 90,
            onHeaderCell: () => ({
                style: {minWidth: 90},
            }),
            render: (_, record) => {
                const tokens = getTokens(record)
                return <UsageCell tokens={tokens} />
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
    ]

    return columns
}
