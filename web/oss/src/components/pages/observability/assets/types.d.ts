import {Avatar} from "antd"
import {ColumnsType} from "antd/es/table"

import {TraceSpanNode} from "@/oss/services/tracing/types"

export interface ObservabilityHeaderProps {
    /** Only the CSV export pipeline reads this — it derives the header row from the column titles. */
    columns: ColumnsType<any>
    componentType: "traces" | "sessions"
    isLoading?: boolean
    onRefresh?: () => void | Promise<void>
    refreshTrigger?: number
}

export type AvatarTreeContentProps = {
    value: TraceSpanNode
} & React.ComponentProps<typeof Avatar>
