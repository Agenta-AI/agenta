import {useCallback, useMemo} from "react"

import {
    EMPTY_FILTERS,
    PATH,
    bucketStarts,
    keyedSeries,
    numberSeries,
    rankKeys,
    toOverview,
    usageAgentNamesAtomFamily,
    usageBucketsAtomFamily,
    usageSplitAtomFamily,
    type KeyedSeries,
    type UsageFilters,
    type UsageFocus,
    type UsageQueryName,
    type UsageWindow,
} from "@agenta/observability/usage"
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

export const useUsageBuckets = (
    name: UsageQueryName,
    window: UsageWindow,
    filters: UsageFilters,
    focus: UsageFocus | null = null,
) => useAtomValue(usageBucketsAtomFamily({name, window, filters, focus}))

const AGENT_PATHS = [PATH.agentApp, PATH.agentWorkflow]

/** Everything the page and the drawer chart from one window: totals, and counts per key. */
export const useUsageWindowData = (
    window: UsageWindow,
    filters: UsageFilters,
    focus: UsageFocus | null = null,
) => {
    const overviewQ = useUsageBuckets("overview", window, filters, focus)
    const failedQ = useUsageBuckets("failed", window, filters, focus)
    const agentsQ = useUsageBuckets("agents", window, filters, focus)
    const agentsFailedQ = useUsageBuckets("agentsFailed", window, filters, focus)
    const modelsQ = useUsageBuckets("models", window, filters, focus)
    const modelsFailedQ = useUsageBuckets("modelsFailed", window, filters, focus)
    // Call-level spans carry no agent reference, so neither filters nor focus narrow them.
    const callsQ = useUsageBuckets("calls", window, EMPTY_FILTERS)
    const toolsQ = useUsageBuckets("tools", window, EMPTY_FILTERS)

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

export type UsageWindowData = ReturnType<typeof useUsageWindowData>

/** Cost and tokens per key, one filtered request per key. */
export const useUsageSplit = (
    dim: UsageFocus["dim"],
    keys: string[],
    window: UsageWindow,
    filters: UsageFilters,
    enabled = true,
    scope: UsageFocus | null = null,
) => {
    const query = useAtomValue(
        usageSplitAtomFamily({dim, keys: enabled ? keys : [], window, filters, scope}),
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
    const names = useAtomValue(usageAgentNamesAtomFamily(ids))
    return useCallback((id: string) => names[id] ?? UNKNOWN_AGENT, [names])
}
