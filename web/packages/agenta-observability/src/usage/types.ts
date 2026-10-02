export type UsageRangeKey = "24h" | "7d" | "30d" | "90d"

export type UsageDimension = "agent" | "model" | "tool"

export type UsageMetric = "cost" | "runs" | "success" | "tokens" | "tools" | "avgcost"

/** Agent ids and configured model names; both narrow the root-span (run) queries. */
export interface UsageFilters {
    agent: string[]
    model: string[]
}

/** A bucketed time window. `interval` is the bucket width in minutes. */
export interface UsageWindow {
    oldest: number
    newest: number
    interval: number
}

export interface UsageTotals {
    cost: number
    runs: number
    failed: number
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    tokens: number
}

export interface UsagePoint extends UsageTotals {
    start: number
}

export interface UsageOverview {
    points: UsagePoint[]
    totals: UsageTotals
}

/** Per-key values over the window's buckets, e.g. runs per agent per day. */
export type KeyedSeries = Record<string, number[]>

export interface UsageSeries {
    key: string
    values: number[]
    other?: boolean
}

export interface UsageRun {
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

export interface UsageRunTools {
    calls: number
    failed: string[]
}

export interface FailureCategory {
    label: string
    fix: string
}
