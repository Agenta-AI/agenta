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
