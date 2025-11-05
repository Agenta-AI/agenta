import {ColumnsType} from "antd/es/table"

import ResultTag from "@/oss/components/ResultTag/ResultTag"
import TruncatedTooltipTag from "@/oss/components/TruncatedTooltipTag"
import {getStringOrJson} from "@/oss/lib/helpers/utils"
import {TraceSpanNode} from "@/oss/services/tracing/types"

import CostCell from "../components/CostCell"
import DurationCell from "../components/DurationCell"
import EvaluatorMetricsCell from "../components/EvaluatorMetricsCell"
import NodeNameCell from "../components/NodeNameCell"
import StatusRenderer from "../components/StatusRenderer"
import TimestampCell from "../components/TimestampCell"
import UsageCell from "../components/UsageCell"
import {
    getCost,
    getLatency,
    getTokens,
    getTraceInputs,
    getTraceOutputs,
} from "@/oss/state/newObservability"

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
                return <ResultTag value1={`# ${record.span_id.split("-")[0]}`} />
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
                return (
                    <TruncatedTooltipTag
                        children={inputs ? getStringOrJson(inputs) : ""}
                        placement="bottom"
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
                return (
                    <TruncatedTooltipTag
                        children={outputs ? getStringOrJson(outputs) : ""}
                        placement="bottom"
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
