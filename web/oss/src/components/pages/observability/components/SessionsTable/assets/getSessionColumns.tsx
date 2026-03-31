import {Key} from "react"

import {EnhancedColumnType} from "@/oss/components/EnhancedUIs/Table/types"

import {
    DurationCell,
    EndTimeCell,
    FirstInputCell,
    LastOutputCell,
    SessionIdCell,
    StartTimeCell,
    TotalCostCell,
    TotalLatencyCell,
    TotalUsageCell,
    TracesCountCell,
} from "../components/Cells"

export interface SessionRow {
    session_id: string
    key: Key
    isSkeleton?: boolean
    __isSkeleton: boolean
}

export const getSessionColumns = (): EnhancedColumnType<SessionRow>[] => [
    {
        title: "Session id",
        dataIndex: "session_id",
        key: "session_id",
        width: 180,
        minWidth: 180,
        fixed: "left",
        render: (sessionId: string) => <SessionIdCell sessionId={sessionId} />,
    },
    {
        title: "Traces",
        dataIndex: "traces",
        key: "traces",
        width: 120,
        minWidth: 120,
        render: (_, record) => <TracesCountCell sessionId={record.session_id} />,
    },
    {
        title: "First input",
        dataIndex: "first_input",
        key: "first_input",
        width: 320,
        minWidth: 240,
        render: (_, record) => <FirstInputCell sessionId={record.session_id} />,
    },
    {
        title: "Last output",
        dataIndex: "last_output",
        key: "last_output",
        width: 320,
        minWidth: 240,
        render: (_, record) => <LastOutputCell sessionId={record.session_id} />,
    },
    {
        title: "Start time",
        dataIndex: "start_time",
        key: "start_time",
        width: 200,
        minWidth: 200,
        render: (_, record) => <StartTimeCell sessionId={record.session_id} />,
    },
    {
        title: "End time",
        dataIndex: "end_time",
        key: "end_time",
        width: 200,
        minWidth: 200,
        render: (_, record) => <EndTimeCell sessionId={record.session_id} />,
    },
    {
        title: "Duration",
        dataIndex: "duration_ms",
        key: "duration_ms",
        width: 120,
        minWidth: 120,
        render: (_, record) => <DurationCell sessionId={record.session_id} />,
    },
    {
        title: "Total Latency",
        dataIndex: "total_latency_ms",
        key: "total_latency_ms",
        width: 140,
        minWidth: 140,
        render: (_, record) => <TotalLatencyCell sessionId={record.session_id} />,
    },
    {
        title: "Total Usage",
        dataIndex: "total_usage",
        key: "total_usage",
        width: 120,
        minWidth: 120,
        render: (_, record) => <TotalUsageCell sessionId={record.session_id} />,
    },
    {
        title: "Total Cost",
        dataIndex: "total_cost",
        key: "total_cost",
        width: 120,
        minWidth: 120,
        render: (_, record) => <TotalCostCell sessionId={record.session_id} />,
    },
]
