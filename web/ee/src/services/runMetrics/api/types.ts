// Aggregated statistics for a metric.
// Only a subset of these properties will be present depending on the metric type.
export interface BasicStats {
    // Always present ---------------------------------------------------------
    count: number

    // Numeric metrics -------------------------------------------------------
    sum?: number
    mean?: number
    min?: number
    max?: number
    range?: number
    distribution?: {value: number; count: number}[]
    percentiles?: Record<string, number>
    iqrs?: Record<string, number>
    binSize?: number

    // Categorical / binary metrics -----------------------------------------
    frequency?: {value: string | number | boolean | null; count: number}[]
    unique?: (string | number | boolean | null)[]
    rank?: {value: string | number | boolean | null; count: number}[]
}
