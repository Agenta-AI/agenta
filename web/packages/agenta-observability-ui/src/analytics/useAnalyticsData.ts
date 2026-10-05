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
    type KeyedSeries,
    type AnalyticsFilters,
    type AnalyticsFocus,
    type AnalyticsQueryName,
    type AnalyticsWindow,
} from "@agenta/observability/analytics"
import {useAtomValue} from "jotai"

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
    // Call-level spans carry no agent reference, so neither filters nor focus narrow them.
    const callsQ = useAnalyticsBuckets("calls", window, EMPTY_FILTERS)
    const toolsQ = useAnalyticsBuckets("tools", window, EMPTY_FILTERS)

    return useMemo(() => {
        const keyed = (data: typeof overviewQ.data, paths: string[]): KeyedSeries =>
            keyedSeries(window, data ?? [], paths)
        const agentRuns = keyed(agentsQ.data, AGENT_PATHS)
        const modelRuns = keyed(modelsQ.data, [PATH.model])
        const callModels = keyed(callsQ.data, [PATH.callModel])
        const toolCalls = keyed(toolsQ.data, [PATH.tool])
        return {
            starts: bucketStarts(window),
            overview: toOverview(window, overviewQ.data ?? [], failedQ.data ?? []),
            agentRuns,
            agentFailed: keyed(agentsFailedQ.data, AGENT_PATHS),
            agentOrder: rankKeys(agentRuns),
            modelRuns,
            modelFailed: keyed(modelsFailedQ.data, [PATH.model]),
            modelOrder: rankKeys(modelRuns),
            callModels,
            callModelOrder: rankKeys(callModels),
            callCost: numberSeries(window, callsQ.data ?? [], PATH.callCost),
            callTokens: numberSeries(window, callsQ.data ?? [], PATH.callTokens),
            toolCalls,
            toolOrder: rankKeys(toolCalls),
            status: {
                overview: statusOf(overviewQ, failedQ),
                agents: statusOf(agentsQ, agentsFailedQ),
                models: statusOf(modelsQ, modelsFailedQ),
                calls: statusOf(callsQ),
                tools: statusOf(toolsQ),
            },
        }
    }, [window, overviewQ, failedQ, agentsQ, agentsFailedQ, modelsQ, modelsFailedQ, callsQ, toolsQ])
}

export type AnalyticsWindowData = ReturnType<typeof useAnalyticsWindowData>

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
        const costPath = dim === "callModel" ? PATH.callCost : PATH.cost
        const tokensPath = dim === "callModel" ? PATH.callTokens : PATH.tokens
        const cost: KeyedSeries = {}
        const tokens: KeyedSeries = {}
        for (const [key, buckets] of Object.entries(query.data ?? {})) {
            cost[key] = numberSeries(window, buckets, costPath)
            tokens[key] = numberSeries(window, buckets, tokensPath)
        }
        return {cost, tokens, status: statusOf(query)}
    }, [dim, query, window])
}

/** A name lookup for agent ids; unknown ids read as "Unknown agent" until they resolve. */
export const useAgentNames = (ids: string[]) => {
    const names = useAtomValue(analyticsAgentNamesAtomFamily(ids))
    return useCallback((id: string) => names[id] ?? UNKNOWN_AGENT, [names])
}
