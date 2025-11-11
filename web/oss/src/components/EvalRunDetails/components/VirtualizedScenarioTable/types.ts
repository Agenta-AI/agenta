import {ColumnsType} from "antd/es/table"

export interface TableRow {
    key: string // scenarioId
    scenarioIndex: number
    status?: string
    result?: string
    baseRunId?: string
    runId?: string
    scenarioId?: string
    /**
     * For skeleton rows shown while data is loading.
     */
    isSkeleton?: boolean
    timestamp?: string | null
    temporalGroupKey?: string
    temporalGroupIndex?: number
    isTemporalGroupStart?: boolean
}

export interface VirtualizedScenarioTableProps {
    columns?: ColumnsType
    dataSource?: TableRow[]
    totalColumnWidth?: number
}
