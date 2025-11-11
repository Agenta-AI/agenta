import { ColumnsType } from "antd/es/table"

export interface TableRow {
    key: string // scenarioId
    scenarioIndex: number
    status?: string
    result?: string
    /**
     * For skeleton rows shown while data is loading.
     */
    isSkeleton?: boolean
}


export interface VirtualizedScenarioTableProps {
    columns?: ColumnsType
    dataSource?: TableRow[]
    totalColumnWidth?: number
}