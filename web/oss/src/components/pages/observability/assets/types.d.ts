import {Avatar} from "antd"
import {ColumnsType} from "antd/es/table"

import {TraceSpanNode} from "@/oss/services/tracing/types"

export interface ObservabilityHeaderProps {
    columns: ColumnsType<TraceSpanNode>
}

export type AvatarTreeContentProps = {
    value: TraceSpanNode
} & React.ComponentProps<typeof Avatar>
