import {agentWorkflowsListQueryStateAtom, workflowMolecule} from "@agenta/entities/workflow"
import {projectIdAtom} from "@agenta/shared/state"
import isEqual from "fast-deep-equal"
import {atom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {
    PATH,
    fetchUsageBuckets,
    fetchUsageRunSpans,
    fetchUsageToolSpans,
    type UsageFocus,
    type UsageQueryName,
} from "./queries"
import {keyedSeries, rangeWindow, toUsageRun, toolsByRun} from "./transform"
import type {
    UsageDimension,
    UsageFilters,
    UsageMetric,
    UsageRangeKey,
    UsageRun,
    UsageRunTools,
    UsageWindow,
} from "./types"

export const usageRangeAtom = atom<UsageRangeKey>("7d")

/** The page's clock; the host ticks it so the window follows real time. */
export const usageNowAtom = atom(Date.now())

// Rounded to the hour or day, so the query keys only move at a boundary.
export const usageWindowAtom = atom<UsageWindow>((get) =>
    rangeWindow(get(usageRangeAtom), get(usageNowAtom)),
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
    scope?: UsageFocus | null
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
                                        scope: key.scope,
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

export interface UsageModelProvidersKey {
    window: UsageWindow
    filters: UsageFilters
    enabled: boolean
}

/** Each configured model's provider: the providers in range, then one model request per provider. */
export const usageModelProvidersAtomFamily = atomFamily(
    (key: UsageModelProvidersKey) =>
        atomWithQuery((get) => {
            const projectId = get(projectIdAtom) as string
            return {
                queryKey: ["usage", "modelProviders", projectId, key.window, key.filters],
                queryFn: async ({signal}) => {
                    const base = {projectId, window: key.window, filters: key.filters, signal}
                    const keysOf = async (name: UsageQueryName, path: string, focus?: UsageFocus) =>
                        Object.keys(
                            keyedSeries(
                                key.window,
                                await fetchUsageBuckets({...base, name, focus}),
                                [path],
                            ),
                        )
                    const providers = await keysOf("providers", PATH.provider)
                    const out: Record<string, string> = {}
                    await Promise.all(
                        providers.map(async (provider) => {
                            const models = await keysOf("models", PATH.model, {
                                dim: "provider",
                                key: provider,
                            })
                            for (const model of models) out[model] = provider
                        }),
                    )
                    return out
                },
                enabled: Boolean(projectId) && key.enabled,
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

export const usageRunsAtomFamily = atomFamily(
    (key: UsageRunsKey) =>
        atomWithQuery((get) => {
            const projectId = get(projectIdAtom)
            return {
                queryKey: ["usage", "runs", projectId, key],
                queryFn: async (): Promise<UsageRun[]> =>
                    (await fetchUsageRunSpans({projectId: projectId as string, ...key})).map(
                        toUsageRun,
                    ),
                enabled: Boolean(projectId),
                ...QUERY_OPTIONS,
            }
        }),
    isEqual,
)

/** Tool calls of the runs on screen, to show call counts and which calls failed. */
export const usageRunToolsAtomFamily = atomFamily(
    (traceIds: string[]) =>
        atomWithQuery((get) => {
            const projectId = get(projectIdAtom)
            return {
                queryKey: ["usage", "run-tools", projectId, traceIds],
                queryFn: async (): Promise<Record<string, UsageRunTools>> =>
                    toolsByRun(await fetchUsageToolSpans(projectId as string, traceIds)),
                enabled: Boolean(projectId) && traceIds.length > 0,
                ...QUERY_OPTIONS,
            }
        }),
    isEqual,
)

/**
 * Agent id to display name: the agents list first, then the workflow artifact, which also
 * names agents that were archived since their runs. Null until known.
 */
export const usageAgentNamesAtomFamily = atomFamily(
    (ids: string[]) =>
        atom((get) => {
            const listed = new Map(
                get(agentWorkflowsListQueryStateAtom).data.map((w) => [w.id, w.name || w.slug]),
            )
            return Object.fromEntries(
                ids.map((id) => [
                    id,
                    listed.get(id) ?? get(workflowMolecule.selectors.artifactName(id)) ?? null,
                ]),
            ) as Record<string, string | null>
        }),
    isEqual,
)

export const usageHasAgentsAtom = atom((get) => {
    const state = get(agentWorkflowsListQueryStateAtom)
    return {pending: state.isPending, failed: state.isError, hasAgents: state.data.length > 0}
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
