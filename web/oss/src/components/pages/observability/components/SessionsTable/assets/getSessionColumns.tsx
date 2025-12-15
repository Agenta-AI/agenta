import {Tag} from "antd"

import TooltipWithCopyAction from "@/oss/components/EnhancedUIs/Tooltip"
import TruncatedTooltipTag from "@/oss/components/TruncatedTooltipTag"
import {getStringOrJson, sanitizeDataWithBlobUrls} from "@/oss/lib/helpers/utils"
import CostCell from "../../CostCell"
import DurationCell from "../../DurationCell"
import TimestampCell from "../../TimestampCell"
import UsageCell from "../../UsageCell"

import {EnhancedColumnType} from "@/oss/components/EnhancedUIs/Table/types"

export type SessionRow = {
    session_id: string
    traces?: number
    first_input?: any
    last_output?: any
    start_time?: string | number
    end_time?: string | number
    duration_ms?: number | null
    total_latency_ms?: number | null
    total_usage?: number | null
    total_cost?: number | null
}

export const getSessionColumns = (): EnhancedColumnType<SessionRow>[] => [
    {
        title: "Session id",
        dataIndex: "session_id",
        key: "session_id",
        width: 180,
        minWidth: 180,
        fixed: "left",
        render: (sessionId: string) => {
            const shortId = sessionId ? sessionId.split("-")[0] : "-"
            return (
                <TooltipWithCopyAction copyText={sessionId || ""} title="Copy session id">
                    <Tag className="font-mono bg-[#0517290F]" bordered={false}>
                        # {shortId}
                    </Tag>
                </TooltipWithCopyAction>
            )
        },
    },
    {
        title: "Traces",
        dataIndex: "traces",
        key: "traces",
        width: 120,
        minWidth: 120,
    },
    {
        title: "First input",
        dataIndex: "first_input",
        key: "first_input",
        width: 320,
        minWidth: 240,
        render: (_, record) => {
            const inputs = record.first_input
            const {data: sanitized} = sanitizeDataWithBlobUrls(inputs)
            return (
                <TruncatedTooltipTag
                    children={inputs ? getStringOrJson(sanitized) : ""}
                    placement="bottom"
                />
            )
        },
    },
    {
        title: "Last output",
        dataIndex: "last_output",
        key: "last_output",
        width: 320,
        minWidth: 240,
        render: (_, record) => {
            const outputs = record.last_output
            return (
                <TruncatedTooltipTag
                    children={outputs ? getStringOrJson(outputs) : ""}
                    placement="bottom"
                />
            )
        },
    },
    {
        title: "Start time",
        dataIndex: "start_time",
        key: "start_time",
        width: 200,
        minWidth: 200,
        render: (_, record) => <TimestampCell timestamp={record.start_time} />,
    },
    {
        title: "End time",
        dataIndex: "end_time",
        key: "end_time",
        width: 200,
        minWidth: 200,
        render: (_, record) => <TimestampCell timestamp={record.end_time} />,
    },
    {
        title: "Duration",
        dataIndex: "duration_ms",
        key: "duration_ms",
        width: 120,
        minWidth: 120,
        render: (_, record) => <DurationCell ms={record.duration_ms ?? null} />,
    },
    {
        title: "Total Latency",
        dataIndex: "total_latency_ms",
        key: "total_latency_ms",
        width: 140,
        minWidth: 140,
        render: (_, record) => <DurationCell ms={record.total_latency_ms ?? null} />,
    },
    {
        title: "Total Usage",
        dataIndex: "total_usage",
        key: "total_usage",
        width: 120,
        minWidth: 120,
        render: (_, record) => <UsageCell tokens={record.total_usage ?? null} />,
    },
    {
        title: "Total Cost",
        dataIndex: "total_cost",
        key: "total_cost",
        width: 120,
        minWidth: 120,
        render: (_, record) => <CostCell cost={record.total_cost ?? null} />,
    },
]
