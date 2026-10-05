export type AnalyticsRangeKey = "24h" | "7d" | "30d" | "90d"

export type AnalyticsDimension = "agent" | "model" | "tool"

/** How the main charts split: not at all, or by agent or configured model. */
export type AnalyticsGroup = "none" | "agent" | "model"

export type AnalyticsMetric = "cost" | "runs" | "success" | "tokens" | "tools" | "avgcost"

/** Agent ids and configured model names; both narrow the root-span (run) queries. */
export interface AnalyticsFilters {
    agent: string[]
    model: string[]
}

/** A bucketed time window. `interval` is the bucket width in minutes. */
export interface AnalyticsWindow {
    oldest: number
    newest: number
    interval: number
}

export interface AnalyticsTotals {
    cost: number
    runs: number
    failed: number
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    tokens: number
}

export interface AnalyticsPoint extends AnalyticsTotals {
    start: number
}

export interface AnalyticsOverview {
    points: AnalyticsPoint[]
    totals: AnalyticsTotals
}

/** Per-key values over the window's buckets, e.g. runs per agent per day. */
export type KeyedSeries = Record<string, number[]>

export interface AnalyticsSeries {
    key: string
    values: number[]
    other?: boolean
}

export interface AnalyticsRun {
    traceId: string
    agentId: string | null
    model: string | null
    startedAt: number
    tokens: number
    cost: number | null
    failed: boolean
    reason: string | null
    subscription: boolean
}

export interface AnalyticsRunTools {
    calls: number
    failed: string[]
}

export interface FailureCategory {
    label: string
    fix: string
}
