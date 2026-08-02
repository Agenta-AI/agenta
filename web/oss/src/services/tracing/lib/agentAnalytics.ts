import type {AnalyticsResponse} from "@agenta/entities/trace"

import type {
    AgentAnalyticsBucket,
    AgentAnalyticsTotals,
    AgentAnalyticsWindow,
} from "../types/agentAnalytics"

import {formatTick, metricField, metricPct, type BucketMetrics} from "./helpers"

// Dotted `MetricSpec.path` keys this page reads. The observability defaults only
// carry `.total`; the split-cost / split-token / latency-percentile fields below
// require an explicit `specs` list on the request. See data-contract.md.
const TRACE_TYPE_PATH = "attributes.ag.type.trace"
const DURATION_PATH = "attributes.ag.metrics.duration.cumulative"
const COST_PROMPT_PATH = "attributes.ag.metrics.costs.cumulative.prompt"
const COST_COMPLETION_PATH = "attributes.ag.metrics.costs.cumulative.completion"
const TOKENS_PROMPT_PATH = "attributes.ag.metrics.tokens.cumulative.prompt"
const TOKENS_COMPLETION_PATH = "attributes.ag.metrics.tokens.cumulative.completion"

// Every number metric is `numeric/continuous` (there is no bare `numeric` in the
// backend `MetricType`); the run count is a categorical frequency.
export const AGENT_ANALYTICS_SPECS = [
    {type: "categorical/single", path: TRACE_TYPE_PATH},
    {type: "numeric/continuous", path: DURATION_PATH},
    {type: "numeric/continuous", path: COST_PROMPT_PATH},
    {type: "numeric/continuous", path: COST_COMPLETION_PATH},
    {type: "numeric/continuous", path: TOKENS_PROMPT_PATH},
    {type: "numeric/continuous", path: TOKENS_COMPLETION_PATH},
] as const

// The status-filtered failed-run query needs only the run count.
export const AGENT_ANALYTICS_FAILED_SPECS = [
    {type: "categorical/single", path: TRACE_TYPE_PATH},
] as const

// Combine the unfiltered window (totals/latency/cost/tokens) with the
// status-filtered window (failed-run count); success = runs − failed per bucket.
export function analyticsToAgentWindow(
    unfiltered: AnalyticsResponse,
    failed: AnalyticsResponse,
    range: string,
): AgentAnalyticsWindow {
    const buckets = unfiltered.buckets ?? []

    const failedByTs = new Map<string, number>()
    for (const b of failed.buckets ?? []) {
        failedByTs.set(
            b.timestamp,
            metricField(b.metrics as BucketMetrics, TRACE_TYPE_PATH, "count"),
        )
    }

    let totalRuns = 0
    let failedRuns = 0
    let totalDurationMs = 0
    let totalDurationCount = 0
    let totalCost = 0
    let totalTokens = 0

    const mapped: AgentAnalyticsBucket[] = buckets.map((b) => {
        const m = b.metrics as BucketMetrics

        const runs = metricField(m, TRACE_TYPE_PATH, "count")
        // Clamp to the unfiltered total: a failed count can never exceed all runs.
        const failedCount = Math.min(runs, Math.max(0, failedByTs.get(b.timestamp) ?? 0))
        const success = runs - failedCount

        const durSum = metricField(m, DURATION_PATH, "sum")
        const durCount = metricField(m, DURATION_PATH, "count")
        const costPrompt = metricField(m, COST_PROMPT_PATH, "sum")
        const costCompletion = metricField(m, COST_COMPLETION_PATH, "sum")
        const tokensPrompt = metricField(m, TOKENS_PROMPT_PATH, "sum")
        const tokensCompletion = metricField(m, TOKENS_COMPLETION_PATH, "sum")

        totalRuns += runs
        failedRuns += failedCount
        totalDurationMs += durSum
        totalDurationCount += durCount
        totalCost += costPrompt + costCompletion
        totalTokens += tokensPrompt + tokensCompletion

        return {
            timestamp: formatTick(b.timestamp, range),
            runs,
            success,
            failed: failedCount,
            latencyAvg: durCount ? durSum / durCount : 0,
            latencyMin: metricField(m, DURATION_PATH, "min"),
            latencyMax: metricField(m, DURATION_PATH, "max"),
            latencyP95: metricPct(m, DURATION_PATH, "p95"),
            costPrompt,
            costCompletion,
            cost: costPrompt + costCompletion,
            tokensPrompt,
            tokensCompletion,
            tokens: tokensPrompt + tokensCompletion,
        }
    })

    const successRuns = totalRuns - failedRuns
    const totals: AgentAnalyticsTotals = {
        totalRuns,
        successRuns,
        failedRuns,
        successRate: totalRuns ? successRuns / totalRuns : 0,
        avgLatency: totalDurationCount ? totalDurationMs / totalDurationCount : 0,
        totalCost,
        totalTokens,
    }

    return {buckets: mapped, totals}
}

export type HealthBand = "healthy" | "watch" | "at-risk" | "insufficient"

// Below this run count in the window, do not band the score; a single failure in
// a quiet window should not read as At risk.
export const HEALTH_RUN_FLOOR = 20

export interface HealthScore {
    /** round(100 × successRate) */
    score: number
    band: HealthBand
    hasEnoughRuns: boolean
}

/** Health is the success rate, banded. Latency does not factor in. */
export function computeHealth(
    totals: AgentAnalyticsTotals,
    floor: number = HEALTH_RUN_FLOOR,
): HealthScore {
    const score = Math.round(100 * totals.successRate)
    if (totals.totalRuns < floor) {
        return {score, band: "insufficient", hasEnoughRuns: false}
    }
    const band: HealthBand = score >= 85 ? "healthy" : score >= 65 ? "watch" : "at-risk"
    return {score, band, hasEnoughRuns: true}
}
