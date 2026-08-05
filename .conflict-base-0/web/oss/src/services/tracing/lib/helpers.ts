import {
    isSpansResponse,
    isTracesResponse,
    sortSpansByStartTime,
    transformTracesResponseToTree,
    transformTracingResponse,
    type AnalyticsResponse,
} from "@agenta/entities/trace"
import dayjs from "dayjs"

import type {GenerationDashboardData} from "../types"

// Re-export entity functions for backward compatibility
export {
    isSpansResponse,
    isTracesResponse,
    sortSpansByStartTime,
    transformTracesResponseToTree,
    transformTracingResponse,
}

export const rangeToIntervalMinutes = (range: string): number => {
    switch (range) {
        case "1h":
            return 60
        case "24h":
            return 60
        case "7d":
            return 360
        case "30d":
            return 720
        default:
            return 720
    }
}

export const calculateIntervalFromDuration = (durationMinutes: number): number => {
    // Backend has a hard limit of ~1024 buckets.
    // We enforce a max of 1000 buckets to be safe and avoid the backend defaulting to 30-day buckets.
    const maxBuckets = 1000
    const calculatedInterval = Math.ceil(durationMinutes / maxBuckets)

    // Explicit mappings for standard frontend ranges to ensure nice granularity (~30-70 bars)
    // 30 mins -> 1 min interval (30 bars)
    if (durationMinutes <= 30) return Math.max(1, calculatedInterval)
    // 1 hour -> 1 min interval (60 bars)
    if (durationMinutes <= 60) return Math.max(1, calculatedInterval)
    // 6 hours -> 5 min interval (72 bars)
    if (durationMinutes <= 60 * 6) return Math.max(5, calculatedInterval)
    // 24 hours -> 30 min interval (48 bars)
    if (durationMinutes <= 60 * 24) return Math.max(30, calculatedInterval)
    // 3 days -> 1 hour interval (72 bars)
    if (durationMinutes <= 60 * 24 * 3) return Math.max(60, calculatedInterval)
    // 7 days -> 3 hour interval (56 bars)
    if (durationMinutes <= 60 * 24 * 7) return Math.max(180, calculatedInterval)
    // 14 days -> 6 hour interval (56 bars)
    if (durationMinutes <= 60 * 24 * 14) return Math.max(360, calculatedInterval)
    // 30 days -> 12 hour interval (60 bars)
    if (durationMinutes <= 60 * 24 * 30) return Math.max(720, calculatedInterval)

    // For longer durations
    // ensuring we never request too many buckets.
    return Math.max(720, calculatedInterval)
}

export const normalizeDurationSeconds = (d = 0) => d / 1_000

export const formatTick = (ts: number | string, range: string) =>
    dayjs(ts).format(range === "24_hours" ? "h:mm a" : range === "7_days" ? "ddd" : "D MMM")

// Dotted `MetricSpec.path` keys for the buckets returned by the new
// `/spans/analytics/query` endpoint. These match the backend's
// DEFAULT_ANALYTICS_SPECS (api/oss/src/core/tracing/service.py), which is what
// the endpoint applies when the request omits `specs`.
const COST_PATH = "attributes.ag.metrics.costs.cumulative.total"
const TOKENS_PATH = "attributes.ag.metrics.tokens.cumulative.total"
const DURATION_PATH = "attributes.ag.metrics.duration.cumulative"
const ERRORS_PATH = "attributes.ag.metrics.errors.cumulative"
const TRACE_TYPE_PATH = "attributes.ag.type.trace"

type BucketMetrics = AnalyticsResponse["buckets"] extends (infer B)[] | null | undefined
    ? B extends {metrics?: infer M}
        ? M
        : never
    : never

/** Read a numeric field (e.g. `sum`, `count`, `mean`) from one metric blob. */
const metricField = (metrics: BucketMetrics, path: string, field: string): number => {
    const blob = metrics?.[path]
    const value = blob?.[field]
    return typeof value === "number" && Number.isFinite(value) ? value : 0
}

/**
 * Map the new spec-based analytics response onto the generation dashboard
 * shape (AGE-3788). The old `/tracing/spans/analytics` endpoint returned a
 * success/error split per bucket (`total` vs `errors`); the new endpoint
 * returns per-metric aggregates keyed by dotted spec path, so we reconstruct
 * the dashboard figures:
 *   - total count   = `type.trace` count (root-span count per bucket)
 *   - failure count = `errors.cumulative` sum
 *   - success count = total − failures
 *   - cost / tokens = `costs|tokens.cumulative.total` sum (over all spans)
 *   - latency       = `duration.cumulative` sum / count (avg over all spans)
 */
export function analyticsToGeneration(
    analytics: AnalyticsResponse,
    range: string,
): GenerationDashboardData {
    const buckets = analytics.buckets ?? []

    let successCount = 0
    let errorCount = 0
    let totalCost = 0
    let totalTokens = 0
    let totalDurationMs = 0
    let totalDurationCount = 0

    const data = buckets.map((b) => {
        const m = b.metrics as BucketMetrics

        const cost = metricField(m, COST_PATH, "sum")
        const tokens = metricField(m, TOKENS_PATH, "sum")
        const failure = metricField(m, ERRORS_PATH, "sum")

        const durationCount = metricField(m, DURATION_PATH, "count")
        // Prefer the trace-type root count; fall back to the duration sample
        // count when the categorical metric is absent (e.g. span focus).
        const total = metricField(m, TRACE_TYPE_PATH, "count") || durationCount
        const success = Math.max(0, total - failure)

        // `ag.metrics.duration.cumulative` is stored in MILLISECONDS, and the
        // dashboard renders latency with an "ms" suffix — so keep it in ms. (The
        // legacy transform divided by 1000 here, which made the dashboard show
        // latencies 1000× too small; verified against live data — AGE-3788.)
        const durationMs = metricField(m, DURATION_PATH, "sum")

        successCount += success
        errorCount += failure
        totalCost += cost
        totalTokens += tokens
        totalDurationMs += durationMs
        totalDurationCount += durationCount

        return {
            timestamp: formatTick(b.timestamp, range),
            success_count: success,
            failure_count: failure,
            cost,
            latency: durationCount ? durationMs / durationCount : 0, // avg latency (ms) in the bucket
            total_tokens: tokens,
        }
    })

    const totalCount = successCount + errorCount

    return {
        data,
        total_count: totalCount,
        failure_rate: totalCount ? errorCount / totalCount : 0,
        total_cost: totalCost,
        avg_cost: totalCount ? totalCost / totalCount : 0,
        avg_latency: totalDurationCount ? totalDurationMs / totalDurationCount : 0, // ms
        total_tokens: totalTokens,
        avg_tokens: totalCount ? totalTokens / totalCount : 0,
    }
}
