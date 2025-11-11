// Aggregated scenario counts used in filters
export interface ScenarioCounts {
    total: number
    pending: number
    unannotated: number
    failed: number
}

export interface StatusCounters {
    pending: number
    running: number
    completed: number
    cancelled: number
    unannotated: number
    failed: number
}
