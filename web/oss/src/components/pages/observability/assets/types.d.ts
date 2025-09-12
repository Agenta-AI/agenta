import {Avatar} from "antd"
import {ColumnsType} from "antd/es/table"

import {_AgentaRootsResponse, TracesWithAnnotations} from "@/oss/services/observability/types"

export interface ObservabilityHeaderProps {
    columns: ColumnsType<TracesWithAnnotations>
}

export type AvatarTreeContentProps = {
    value: _AgentaRootsResponse
} & React.ComponentProps<typeof Avatar>
