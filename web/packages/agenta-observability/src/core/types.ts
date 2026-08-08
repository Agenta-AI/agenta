/** The preset names the range picker offers; `custom` pairs with an explicit start/end. */
export type AnalyticsRangeLabel =
    | "30 mins"
    | "1 hour"
    | "6 hours"
    | "24 hours"
    | "3 days"
    | "7 days"
    | "14 days"
    | "1 month"
    | "3 months"
    | "all time"
    | "custom"
    | ""

/** A resolved time window: `sorted` is the ISO start for standard presets. */
export interface AnalyticsRange {
    type: "custom" | "standard"
    sorted: string
    customRange?: {startTime?: string; endTime?: string}
    label?: AnalyticsRangeLabel
}

/**
 * The dashboard figures every usage surface reads — one bucket series plus the roll-ups.
 *
 * `/spans/analytics/query` carries no per-bucket environment/variant and does not split tokens
 * by prompt/completion, so those four stay optional and unpopulated.
 */
export interface DashboardData {
    data: {
        timestamp: number | string
        success_count: number
        failure_count: number
        cost: number
        latency: number
        total_tokens: number
        prompt_tokens?: number
        completion_tokens?: number
        enviornment?: string
        variant?: string
    }[]
    total_count: number
    failure_rate: number
    total_cost: number
    avg_cost: number
    avg_latency: number
    total_tokens: number
    avg_tokens: number
}
