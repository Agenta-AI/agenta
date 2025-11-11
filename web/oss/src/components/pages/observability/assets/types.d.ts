import {Dispatch, SetStateAction, Key} from "react"

import {Avatar} from "antd"
import {ColumnsType} from "antd/es/table"

import {_AgentaRootsResponse, TracesWithAnnotations} from "@/oss/services/observability/types"

import {TestsetTraceData} from "../../drawer/TestsetDrawer/assets/types"

export interface ObservabilityHeaderProps {
    setEditColumns: Dispatch<SetStateAction<string[]>>
    selectedRowKeys: Key[]
    setTestsetDrawerData: Dispatch<SetStateAction<TestsetTraceData[]>>
    editColumns: string[]
    columns: ColumnsType<TracesWithAnnotations>
}

export type AvatarTreeContentProps = {
    value: _AgentaRootsResponse
} & React.ComponentProps<typeof Avatar>
