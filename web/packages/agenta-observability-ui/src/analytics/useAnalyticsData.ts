import {useCallback, useMemo} from "react"

import {
    EMPTY_FILTERS,
    PATH,
    bucketStarts,
    keyedSeries,
    numberSeries,
    rankKeys,
    toOverview,
    analyticsAgentNamesAtomFamily,
    analyticsBucketsAtomFamily,
    analyticsSplitAtomFamily,
    analyticsRunsAtomFamily,
    categorizeFailure,
    type KeyedSeries,
    type AnalyticsFilters,
    type AnalyticsFocus,
    type AnalyticsGroup,
    type AnalyticsQueryName,
    type AnalyticsWindow,
} from "@agenta/observability/analytics"
import {useAtomValue} from "jotai"

import {SERIES_COLORS, analyticsColor} from "./colors"
import {UNKNOWN_AGENT} from "./labels"

export interface QueryStatus {
    pending: boolean
    error: unknown
    refetch: () => void
}

interface QueryLike {
    isPending: boolean
    fetchStatus: string
    error: unknown
    refetch: () => unknown
}

// A disabled query (nothing to fetch) stays `isPending` forever; idle means settled.
const statusOf = (...queries: QueryLike[]) => ({
    pending: queries.some((q) => q.isPending && q.fetchStatus !== "idle"),
    error: queries.find((q) => q.error)?.error ?? null,
    refetch: () => queries.forEach((q) => void q.refetch()),
})

export const useAnalyticsBuckets = (
    name: AnalyticsQueryName,
    window: AnalyticsWindow,
    filters: AnalyticsFilters,
    focus: AnalyticsFocus | null = null,
) => useAtomValue(analyticsBucketsAtomFamily({name, window, filters, focus}))

const AGENT_PATHS = [PATH.agentApp, PATH.agentWorkflow]

/** Everything the page and the drawer chart from one window: totals, and counts per key. */
export const useAnalyticsWindowData = (
    window: AnalyticsWindow,
    filters: AnalyticsFilters,
    focus: AnalyticsFocus | null = null,
) => {
    const overviewQ = useAnalyticsBuckets("overview", window, filters, focus)
    const failedQ = useAnalyticsBuckets("failed", window, filters, focus)
    const agentsQ = useAnalyticsBuckets("agents", window, filters, focus)
    const agentsFailedQ = useAnalyticsBuckets("agentsFailed", window, filters, focus)
    const modelsQ = useAnalyticsBuckets("models", window, filters, focus)
    const modelsFailedQ = useAnalyticsBuckets("modelsFailed", window, filters, focus)

    return useMemo(() => {
        const keyed = (data: typeof overviewQ.data, paths: string[]): KeyedSeries =>
            keyedSeries(window, data ?? [], paths)
        const agentRuns = keyed(agentsQ.data, AGENT_PATHS)
        const modelRuns = keyed(modelsQ.data, [PATH.model])
        return {
            starts: bucketStarts(window),
            overview: toOverview(window, overviewQ.data ?? [], failedQ.data ?? []),
            agentRuns,
            agentFailed: keyed(agentsFailedQ.data, AGENT_PATHS),
            agentOrder: rankKeys(agentRuns),
            modelRuns,
            modelFailed: keyed(modelsFailedQ.data, [PATH.model]),
            modelOrder: rankKeys(modelRuns),
            status: {
                overview: statusOf(overviewQ, failedQ),
                agents: statusOf(agentsQ, agentsFailedQ),
                models: statusOf(modelsQ, modelsFailedQ),
            },
        }
    }, [window, overviewQ, failedQ, agentsQ, agentsFailedQ, modelsQ, modelsFailedQ])
}

export type AnalyticsWindowData = ReturnType<typeof useAnalyticsWindowData>

/** Tool calls per tool; tool spans carry no agent reference, so filters do not narrow them. */
export const useAnalyticsTools = (window: AnalyticsWindow) => {
    const query = useAnalyticsBuckets("tools", window, EMPTY_FILTERS)
    return useMemo(() => {
        const calls = keyedSeries(window, query.data ?? [], [PATH.tool])
        return {calls, order: rankKeys(calls), status: statusOf(query)}
    }, [window, query])
}

export type AnalyticsTools = ReturnType<typeof useAnalyticsTools>

/** Cost and tokens per key, one filtered request per key. */
export const useAnalyticsSplit = (
    dim: AnalyticsFocus["dim"],
    keys: string[],
    window: AnalyticsWindow,
    filters: AnalyticsFilters,
    enabled = true,
    scope: AnalyticsFocus | null = null,
) => {
    const query = useAtomValue(
        analyticsSplitAtomFamily({dim, keys: enabled ? keys : [], window, filters, scope}),
    )
    return useMemo(() => {
        const cost: KeyedSeries = {}
        const tokens: KeyedSeries = {}
        for (const [key, buckets] of Object.entries(query.data ?? {})) {
            cost[key] = numberSeries(window, buckets, PATH.cost)
            tokens[key] = numberSeries(window, buckets, PATH.tokens)
        }
        return {cost, tokens, status: statusOf(query)}
    }, [query, window])
}

/** A name lookup for agent ids; unknown ids read as "Unknown agent" until they resolve. */
export const useAgentNames = (ids: string[]) => {
    const names = useAtomValue(analyticsAgentNamesAtomFamily(ids))
    return useCallback((id: string) => names[id] ?? UNKNOWN_AGENT, [names])
}

/** Splits cost one request per key, so they stop here. */
export const SPLIT_KEYS = 25

export type KeyColor = (dim: "agent" | "model", key: string) => string

/** Page data, its splits, and per-key colors the page and drawer share. */
export const usePageAnalytics = (
    window: AnalyticsWindow,
    filters: AnalyticsFilters,
    group: AnalyticsGroup,
) => {
    const data = useAnalyticsWindowData(window, filters)
    const agentSplit = useAnalyticsSplit(
        "agent",
        data.agentOrder.slice(0, SPLIT_KEYS),
        window,
        filters,
        group === "agent",
    )
    const modelSplit = useAnalyticsSplit(
        "model",
        data.modelOrder.slice(0, SPLIT_KEYS),
        window,
        filters,
        group === "model",
    )
    const keyColor = useMemo<KeyColor>(() => {
        const shown = (...series: KeyedSeries[]) => [
            ...new Set(series.flatMap((s) => rankKeys(s).slice(0, 4))),
        ]
        const orders = {
            agent: shown(data.agentRuns, agentSplit.cost, agentSplit.tokens),
            model: shown(data.modelRuns, modelSplit.cost, modelSplit.tokens),
        }
        return (dim, key) => {
            const index = orders[dim].indexOf(key)
            return index < 0
                ? analyticsColor("other")
                : analyticsColor(SERIES_COLORS[index % SERIES_COLORS.length])
        }
    }, [data.agentRuns, data.modelRuns, agentSplit, modelSplit])
    return {data, agentSplit, modelSplit, keyColor}
}

/** Failed runs fetched to read their reasons; a window with more uses the newest. */
export const FAILURE_SAMPLE = 100

export interface ReasonCount {
    label: string
    count: number
}

const ranked = (counts: Record<string, number>): ReasonCount[] =>
    Object.entries(counts)
        .map(([label, count]) => ({label, count}))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))

/** Why runs failed, for the range and per bucket, from the newest failed runs. */
export const useFailureReasons = (
    window: AnalyticsWindow,
    filters: AnalyticsFilters,
    failed: number,
) => {
    const query = useAtomValue(
        analyticsRunsAtomFamily({
            window,
            filters,
            focus: null,
            failedOnly: true,
            limit: FAILURE_SAMPLE,
            enabled: failed > 0,
        }),
    )
    return useMemo(() => {
        const width = window.interval * 60_000
        const size = bucketStarts(window).length
        const byReason: KeyedSeries = {}
        const bucketAgents = Array.from({length: size}, () => ({}) as Record<string, number>)
        const agentReasons: Record<string, Record<string, number>> = {}
        const runs = query.data ?? []
        for (const run of runs) {
            const label = categorizeFailure(run.reason).label
            if (run.agentId) {
                const reasons = (agentReasons[run.agentId] ??= {})
                reasons[label] = (reasons[label] ?? 0) + 1
            }
            const i = Math.floor((run.startedAt - window.oldest) / width)
            if (i < 0 || i >= size) continue
            ;(byReason[label] ??= Array.from({length: size}, () => 0))[i] += 1
            if (run.agentId) bucketAgents[i][run.agentId] = (bucketAgents[i][run.agentId] ?? 0) + 1
        }
        return {
            mainReason: (agentId: string) => ranked(agentReasons[agentId] ?? {})[0]?.label ?? null,
            reasonsAt: (bucket: number) =>
                ranked(
                    Object.fromEntries(
                        Object.entries(byReason)
                            .map(([label, values]) => [label, values[bucket] ?? 0] as const)
                            .filter(([, count]) => count > 0),
                    ),
                ),
            busiestAgent: (bucket: number) => ranked(bucketAgents[bucket] ?? {})[0]?.label ?? null,
            sampled: runs.length,
            status: statusOf(query),
        }
    }, [query, window])
}

export type FailureReasons = ReturnType<typeof useFailureReasons>
