import {agentWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {projectIdAtom} from "@agenta/shared/state"
import isEqual from "fast-deep-equal"
import {atom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {
    fetchUsageBuckets,
    fetchUsageRunSpans,
    fetchUsageToolSpans,
    type UsageFocus,
    type UsageQueryName,
} from "./queries"
import {rangeWindow, toUsageRun, toolsByRun} from "./transform"
import type {
    UsageDimension,
    UsageFilters,
    UsageMetric,
    UsageRangeKey,
    UsageRun,
    UsageRunTools,
    UsageWindow,
} from "./types"

export const usageRangeAtom = atom<UsageRangeKey>("30d")

// Rounded to the hour or day, so the query keys only move at a boundary.
export const usageWindowAtom = atom<UsageWindow>((get) =>
    rangeWindow(get(usageRangeAtom), Date.now()),
)

export const EMPTY_FILTERS: UsageFilters = {agent: [], model: []}

export const usageFiltersAtom = atom<UsageFilters>(EMPTY_FILTERS)

const QUERY_OPTIONS = {staleTime: 60_000, refetchOnWindowFocus: false} as const

export interface UsageBucketsKey {
    name: UsageQueryName
    window: UsageWindow
    filters: UsageFilters
    focus?: UsageFocus | null
}

export const usageBucketsAtomFamily = atomFamily(
    (key: UsageBucketsKey) =>
        atomWithQuery((get) => {
            const projectId = get(projectIdAtom)
            return {
                queryKey: ["usage", "buckets", projectId, key],
                queryFn: ({signal}) =>
                    fetchUsageBuckets({projectId: projectId as string, ...key, signal}),
                enabled: Boolean(projectId),
                ...QUERY_OPTIONS,
            }
        }),
    isEqual,
)

/** One filtered request per key: how cost and tokens split by agent or model without a group-by. */
export interface UsageSplitKey {
    dim: UsageFocus["dim"]
    keys: string[]
    window: UsageWindow
    filters: UsageFilters
}

export const usageSplitAtomFamily = atomFamily(
    (key: UsageSplitKey) =>
        atomWithQuery((get) => {
            const projectId = get(projectIdAtom)
            const name: UsageQueryName = key.dim === "callModel" ? "calls" : "overview"
            return {
                queryKey: ["usage", "split", projectId, key],
                queryFn: async ({signal}) => {
                    const entries = await Promise.all(
                        key.keys.map(
                            async (k) =>
                                [
                                    k,
                                    await fetchUsageBuckets({
                                        projectId: projectId as string,
                                        name,
                                        window: key.window,
                                        filters: key.filters,
                                        focus: {dim: key.dim, key: k},
                                        signal,
                                    }),
                                ] as const,
                        ),
                    )
                    return Object.fromEntries(entries)
                },
                enabled: Boolean(projectId) && key.keys.length > 0,
                ...QUERY_OPTIONS,
            }
        }),
    isEqual,
)

export interface UsageRunsKey {
    window: UsageWindow
    filters: UsageFilters
    focus?: UsageFocus | null
    failedOnly: boolean
    limit: number
}

export interface UsageRunsResult {
    runs: UsageRun[]
    tools: Record<string, UsageRunTools>
}

export const usageRunsAtomFamily = atomFamily(
    (key: UsageRunsKey) =>
        atomWithQuery((get) => {
            const projectId = get(projectIdAtom)
            return {
                queryKey: ["usage", "runs", projectId, key],
                queryFn: async (): Promise<UsageRunsResult> => {
                    const spans = await fetchUsageRunSpans({projectId: projectId as string, ...key})
                    const runs = spans.map(toUsageRun)
                    const toolSpans = await fetchUsageToolSpans(
                        projectId as string,
                        runs.map((run) => run.traceId),
                    )
                    return {runs, tools: toolsByRun(toolSpans)}
                },
                enabled: Boolean(projectId),
                ...QUERY_OPTIONS,
            }
        }),
    isEqual,
)

/** Agent id to display name, from the agents list (artifact name, then slug). */
export const usageAgentNamesAtom = atom((get) => {
    const names: Record<string, string> = {}
    for (const workflow of get(agentWorkflowsListQueryStateAtom).data) {
        names[workflow.id] = workflow.name || workflow.slug || workflow.id
    }
    return names
})

export const usageHasAgentsAtom = atom((get) => {
    const state = get(agentWorkflowsListQueryStateAtom)
    return {pending: state.isPending, hasAgents: state.data.length > 0}
})

export interface UsageDrawerState {
    /** A bucket of the page window, or null for the whole window. */
    bucket: number | null
    metric: UsageMetric
    dim: UsageDimension
    focus: UsageFocus | null
    failedOnly: boolean
}

export const usageDrawerAtom = atom<UsageDrawerState | null>(null)
