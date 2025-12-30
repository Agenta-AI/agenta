export interface PreviewTableRow {
    rowId: string
    key: string
    id?: string
    scenarioId?: string
    runId?: string
    testcaseId?: string
    baseScenarioId?: string
    compareIndex?: number
    isComparisonRow?: boolean
    scenarioIndex: number
    status: string
    createdAt: string
    updatedAt: string
    createdById?: string
    updatedById?: string
    /** Timestamp for online evaluation scenarios (batch grouping) */
    timestamp?: string | null
    __isSkeleton: boolean
}
