import type {AnalyticsResponse} from "@agenta/entities/trace"
import dayjs from "dayjs"

import type {
    AgentAnalyticsBreakdownItem,
    AgentAnalyticsBreakdowns,
    AgentAnalyticsBucket,
    AgentAnalyticsTotals,
    AgentAnalyticsWindow,
} from "../types/agentAnalytics"

import {metricField, metricPct, type BucketMetrics} from "./helpers"

// Dotted `MetricSpec.path` keys this page reads. The observability defaults only
// carry `.total`; the token-split / latency-percentile fields below require an
// explicit `specs` list on the request. See data-contract.md.
const TRACE_TYPE_PATH = "attributes.ag.type.trace"
const DURATION_PATH = "attributes.ag.metrics.duration.cumulative"
// The canonical cost roll-up never reaches the agent root span; the only populated
// path is the harness's own reported run total. It is a single coverage-gated value.
const COST_PATH = "attributes.gen_ai.usage.cost"
const TOKENS_TOTAL_PATH = "attributes.ag.metrics.tokens.cumulative.total"
const TOKENS_PROMPT_PATH = "attributes.ag.metrics.tokens.cumulative.prompt"
const TOKENS_COMPLETION_PATH = "attributes.ag.metrics.tokens.cumulative.completion"

// Category paths for the harness and configured-model filter option lists.
const HARNESS_PATH = "attributes.ag.data.parameters.agent.harness.kind"
const MODEL_PATH = "attributes.ag.data.parameters.agent.llm.model"

// Below this share of runs, a coverage-gated metric (cost, token split) is treated
// as unavailable rather than shown as a misleading zero. See data-contract.md.
export const COVERAGE_THRESHOLD = 0.5

export const hasCoverage = (count: number, runs: number, threshold = COVERAGE_THRESHOLD): boolean =>
    runs > 0 && count / runs >= threshold

// Every number metric is `numeric/continuous` (there is no bare `numeric` in the
// backend `MetricType`); the run count is a categorical frequency.
export const AGENT_ANALYTICS_SPECS = [
    {type: "categorical/single", path: TRACE_TYPE_PATH},
    {type: "numeric/continuous", path: DURATION_PATH},
    {type: "numeric/continuous", path: COST_PATH},
    {type: "numeric/continuous", path: TOKENS_TOTAL_PATH},
    {type: "numeric/continuous", path: TOKENS_PROMPT_PATH},
    {type: "numeric/continuous", path: TOKENS_COMPLETION_PATH},
] as const

// The status-filtered failed-run query needs only the run count.
export const AGENT_ANALYTICS_FAILED_SPECS = [
    {type: "categorical/single", path: TRACE_TYPE_PATH},
] as const

// Just the harness/model freqs, for the filter dropdowns' option lists.
export const AGENT_ANALYTICS_FILTER_OPTION_SPECS = [
    {type: "categorical/single", path: HARNESS_PATH},
    {type: "categorical/single", path: MODEL_PATH},
] as const

interface FreqEntry {
    value?: unknown
    count?: unknown
}

// Read a categorical spec's `freq` array (`[{value, count, density}]`) off one bucket.
const metricFreq = (metrics: BucketMetrics, path: string): FreqEntry[] => {
    const freq = (metrics?.[path] as {freq?: unknown} | undefined)?.freq
    return Array.isArray(freq) ? (freq as FreqEntry[]) : []
}

const emptyBreakdowns = (): AgentAnalyticsBreakdowns => ({harness: [], model: []})

// The requested window, used to rebuild a continuous x-axis. The backend omits
// empty buckets, so without this the sparse buckets that come back get spread
// evenly across the chart and read as if they were outside the range.
export interface AnalyticsAxisWindow {
    /** ISO start of the requested window (buckets are aligned to this). */
    oldest: string
    /** ISO end of the requested window. */
    newest: string
    /** Requested bucket width in minutes; matches bucket spacing below 1024 buckets. */
    intervalMinutes: number
}

// Guard against a pathological window/interval producing an unbounded grid.
const MAX_AXIS_SLOTS = 2000

const zeroBucket = (timestamp: string): AgentAnalyticsBucket => ({
    timestamp,
    runs: 0,
    success: 0,
    failed: 0,
    latencyAvg: 0,
    latencyMin: 0,
    latencyMax: 0,
    latencyP95: 0,
    cost: 0,
    tokens: 0,
    tokensPrompt: 0,
    tokensCompletion: 0,
})

// Place each non-empty bucket onto its true time slot and zero-fill the gaps, so
// bars sit where they belong on a real timeline. Slots are anchored to `oldest`
// (the backend bins from there), and the grid is stretched to cover any bucket
// that lands past `newest` (e.g. the current partial bucket).
const buildContinuousAxis = (
    present: AgentAnalyticsBucket[],
    axis: AnalyticsAxisWindow,
): AgentAnalyticsBucket[] => {
    const stepMs = Math.max(1, Math.round(axis.intervalMinutes)) * 60_000
    const oldestMs = dayjs(axis.oldest).valueOf()
    const newestMs = dayjs(axis.newest).valueOf()
    if (!Number.isFinite(oldestMs) || !Number.isFinite(newestMs)) return present

    const byIndex = new Map<number, AgentAnalyticsBucket>()
    let maxPresentIndex = 0
    for (const bucket of present) {
        const ms = dayjs(bucket.timestamp).valueOf()
        if (!Number.isFinite(ms)) continue
        const index = Math.max(0, Math.round((ms - oldestMs) / stepMs))
        byIndex.set(index, bucket)
        maxPresentIndex = Math.max(maxPresentIndex, index)
    }

    const lastIndex = Math.min(
        MAX_AXIS_SLOTS,
        Math.max(maxPresentIndex, Math.round((newestMs - oldestMs) / stepMs)),
    )

    const slots: AgentAnalyticsBucket[] = []
    for (let i = 0; i <= lastIndex; i++) {
        slots.push(byIndex.get(i) ?? zeroBucket(dayjs(oldestMs + i * stepMs).toISOString()))
    }
    return slots
}

// Combine the unfiltered window (totals/latency/cost/tokens) with the
// status-filtered window (failed-run count); success = runs − failed per bucket.
export function analyticsToAgentWindow(
    unfiltered: AnalyticsResponse,
    failed: AnalyticsResponse,
    range: string,
    axis?: AnalyticsAxisWindow,
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
    let totalCost = 0
    let costCount = 0
    let totalTokens = 0
    let tokenSplitCount = 0

    const mapped: AgentAnalyticsBucket[] = buckets.map((b) => {
        const m = b.metrics as BucketMetrics

        const runs = metricField(m, TRACE_TYPE_PATH, "count")
        // Clamp to the unfiltered total: a failed count can never exceed all runs.
        const failedCount = Math.min(runs, Math.max(0, failedByTs.get(b.timestamp) ?? 0))
        const success = runs - failedCount

        const durSum = metricField(m, DURATION_PATH, "sum")
        const durCount = metricField(m, DURATION_PATH, "count")
        const cost = metricField(m, COST_PATH, "sum")
        const tokensPrompt = metricField(m, TOKENS_PROMPT_PATH, "sum")
        const tokensCompletion = metricField(m, TOKENS_COMPLETION_PATH, "sum")

        totalRuns += runs
        totalCost += cost
        costCount += metricField(m, COST_PATH, "count")
        totalTokens += metricField(m, TOKENS_TOTAL_PATH, "sum")
        tokenSplitCount += metricField(m, TOKENS_PROMPT_PATH, "count")

        return {
            // Keep the raw bucket start; the chart layer formats and de-duplicates
            // the x-axis labels. Baking a day-granular label here made sub-day
            // buckets collapse to the same tick (a date shown twice).
            timestamp: String(b.timestamp),
            runs,
            success,
            failed: failedCount,
            latencyAvg: durCount ? durSum / durCount : 0,
            latencyMin: metricField(m, DURATION_PATH, "min"),
            latencyMax: metricField(m, DURATION_PATH, "max"),
            latencyP95: metricPct(m, DURATION_PATH, "p95"),
            cost,
            tokens: metricField(m, TOKENS_TOTAL_PATH, "sum"),
            tokensPrompt,
            tokensCompletion,
        }
    })

    const totals: AgentAnalyticsTotals = {
        totalRuns,
        totalCost,
        totalTokens,
        costCount,
        tokenSplitCount,
    }

    // Rebuild a continuous timeline: the backend drops empty buckets, so without
    // this the few non-empty ones spread across the width and read as out-of-range.
    const continuous = axis ? buildContinuousAxis(mapped, axis) : mapped

    return {buckets: continuous, totals, range}
}

// Sum a category spec's `freq` counts across every bucket into a per-value map.
const reduceFreq = (
    response: AnalyticsResponse,
    path: string,
    into: Map<string, number>,
): Map<string, number> => {
    for (const b of response.buckets ?? []) {
        for (const entry of metricFreq(b.metrics as BucketMetrics, path)) {
            const value = entry.value
            if (value === null || value === undefined || value === "") continue
            const key = String(value)
            const count = typeof entry.count === "number" ? entry.count : Number(entry.count) || 0
            into.set(key, (into.get(key) ?? 0) + count)
        }
    }
    return into
}

const toSortedItems = (counts: Map<string, number>): AgentAnalyticsBreakdownItem[] =>
    [...counts.entries()]
        .map(([key, count]) => ({key, label: key, count}))
        .sort((a, b) => b.count - a.count)

// Reduce the response's harness/model `freq` arrays into sorted per-category counts
// for the filter option lists.
export function analyticsToBreakdowns(
    response: AnalyticsResponse | null | undefined,
): AgentAnalyticsBreakdowns {
    if (!response) return emptyBreakdowns()

    return {
        harness: toSortedItems(reduceFreq(response, HARNESS_PATH, new Map())),
        model: toSortedItems(reduceFreq(response, MODEL_PATH, new Map())),
    }
}
