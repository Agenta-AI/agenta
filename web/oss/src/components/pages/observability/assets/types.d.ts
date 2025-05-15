import {Dispatch, SetStateAction, Key} from "react"
import {ColumnsType} from "antd/es/table"
import {TestsetTraceData} from "../../drawer/TestsetDrawer/assets/types"
import {TracesWithAnnotations} from "../ObservabilityDashboard"

export interface ObservabilityHeaderProps {
    setEditColumns: Dispatch<SetStateAction<string[]>>
    selectedRowKeys: Key[]
    setTestsetDrawerData: Dispatch<SetStateAction<TestsetTraceData[]>>
    editColumns: string[]
    columns: ColumnsType<TracesWithAnnotations>
}
