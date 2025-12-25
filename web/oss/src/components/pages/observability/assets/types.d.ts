import {Avatar} from "antd"
import {ColumnsType} from "antd/es/table"

import {TraceSpanNode} from "@/oss/services/tracing/types"

export interface ObservabilityHeaderProps {
    columns: ColumnsType<any>
    componentType: "traces" | "sessions"
    isLoading?: boolean
    onRefresh?: () => void
    // Session-specific props
    realtimeMode?: boolean
    setRealtimeMode?: (value: boolean) => void
    autoRefresh?: boolean
    setAutoRefresh?: (value: boolean) => void
}

export type AvatarTreeContentProps = {
    value: TraceSpanNode
} & React.ComponentProps<typeof Avatar>
