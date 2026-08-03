import type {AnalyticsResponse} from "@agenta/entities/trace"

import type {
    AgentAnalyticsBreakdownItem,
    AgentAnalyticsBreakdowns,
    AgentAnalyticsBucket,
    AgentAnalyticsTotals,
    AgentAnalyticsWindow,
} from "../types/agentAnalytics"

import {formatTick, metricField, metricPct, type BucketMetrics} from "./helpers"

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

// Breakdown category paths. Agent runs union two reference families.
const HARNESS_PATH = "attributes.ag.data.parameters.agent.harness.kind"
const MODEL_PATH = "attributes.ag.data.parameters.agent.llm.model"
const WORKFLOW_VARIANT_PATH = "attributes.ag.references.workflow_variant.id"
const APPLICATION_VARIANT_PATH = "attributes.ag.references.application_variant.id"

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

// Category breakdowns run as their own bucketed call to stay under the per-request
// spec budget; each spec's `freq` array carries the per-category counts.
export const AGENT_ANALYTICS_BREAKDOWN_SPECS = [
    {type: "categorical/single", path: HARNESS_PATH},
    {type: "categorical/single", path: MODEL_PATH},
    {type: "categorical/single", path: WORKFLOW_VARIANT_PATH},
    {type: "categorical/single", path: APPLICATION_VARIANT_PATH},
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

const emptyBreakdowns = (): AgentAnalyticsBreakdowns => ({harness: [], model: [], agent: []})

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
            timestamp: formatTick(b.timestamp, range),
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

    return {buckets: mapped, totals, breakdowns: emptyBreakdowns()}
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

const toSortedItems = (
    counts: Map<string, number>,
    labelFor?: (key: string) => string,
): AgentAnalyticsBreakdownItem[] =>
    [...counts.entries()]
        .map(([key, count]) => ({key, label: labelFor ? labelFor(key) : key, count}))
        .sort((a, b) => b.count - a.count)

// Reduce the breakdown response's `freq` arrays into sorted per-category counts.
// `agentLabelFor` maps an agent variant id to a friendly name when one is known.
export function analyticsToBreakdowns(
    response: AnalyticsResponse | null | undefined,
    agentLabelFor?: (key: string) => string,
): AgentAnalyticsBreakdowns {
    if (!response) return emptyBreakdowns()

    const agentCounts = new Map<string, number>()
    reduceFreq(response, WORKFLOW_VARIANT_PATH, agentCounts)
    reduceFreq(response, APPLICATION_VARIANT_PATH, agentCounts)

    return {
        harness: toSortedItems(reduceFreq(response, HARNESS_PATH, new Map())),
        model: toSortedItems(reduceFreq(response, MODEL_PATH, new Map())),
        agent: toSortedItems(agentCounts, agentLabelFor),
    }
}
