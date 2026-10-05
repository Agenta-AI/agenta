import {agentWorkflowsListQueryStateAtom, workflowMolecule} from "@agenta/entities/workflow"
import {projectIdAtom} from "@agenta/shared/state"
import isEqual from "fast-deep-equal"
import {atom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {
    PATH,
    fetchAnalyticsBuckets,
    fetchAnalyticsRunSpans,
    fetchAnalyticsToolSpans,
    type AnalyticsFocus,
    type AnalyticsQueryName,
} from "./queries"
import {keyedSeries, rangeWindow, toAnalyticsRun, toolsByRun} from "./transform"
import type {
    AnalyticsDimension,
    AnalyticsFilters,
    AnalyticsMetric,
    AnalyticsRangeKey,
    AnalyticsRun,
    AnalyticsRunTools,
    AnalyticsWindow,
} from "./types"

export const analyticsRangeAtom = atom<AnalyticsRangeKey>("7d")

/** The page's clock; the host ticks it so the window follows real time. */
export const analyticsNowAtom = atom(Date.now())

// Rounded to the hour or day, so the query keys only move at a boundary.
export const analyticsWindowAtom = atom<AnalyticsWindow>((get) =>
    rangeWindow(get(analyticsRangeAtom), get(analyticsNowAtom)),
)

export const EMPTY_FILTERS: AnalyticsFilters = {agent: [], model: []}

export const analyticsFiltersAtom = atom<AnalyticsFilters>(EMPTY_FILTERS)

const QUERY_OPTIONS = {staleTime: 60_000, refetchOnWindowFocus: false} as const

export interface AnalyticsBucketsKey {
    name: AnalyticsQueryName
    window: AnalyticsWindow
    filters: AnalyticsFilters
    focus?: AnalyticsFocus | null
}

export const analyticsBucketsAtomFamily = atomFamily(
    (key: AnalyticsBucketsKey) =>
        atomWithQuery((get) => {
            const projectId = get(projectIdAtom)
            return {
                queryKey: ["analytics", "buckets", projectId, key],
                queryFn: ({signal}) =>
                    fetchAnalyticsBuckets({projectId: projectId as string, ...key, signal}),
                enabled: Boolean(projectId),
                ...QUERY_OPTIONS,
            }
        }),
    isEqual,
)

/** One filtered request per key: how cost and tokens split by agent or model without a group-by. */
export interface AnalyticsSplitKey {
    dim: AnalyticsFocus["dim"]
    keys: string[]
    window: AnalyticsWindow
    filters: AnalyticsFilters
    scope?: AnalyticsFocus | null
}

export const analyticsSplitAtomFamily = atomFamily(
    (key: AnalyticsSplitKey) =>
        atomWithQuery((get) => {
            const projectId = get(projectIdAtom)
            const name: AnalyticsQueryName = key.dim === "callModel" ? "calls" : "overview"
            return {
                queryKey: ["analytics", "split", projectId, key],
                queryFn: async ({signal}) => {
                    const entries = await Promise.all(
                        key.keys.map(
                            async (k) =>
                                [
                                    k,
                                    await fetchAnalyticsBuckets({
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

export interface AnalyticsModelProvidersKey {
    window: AnalyticsWindow
    filters: AnalyticsFilters
    enabled: boolean
}

/** Each configured model's provider: the providers in range, then one model request per provider. */
export const analyticsModelProvidersAtomFamily = atomFamily(
    (key: AnalyticsModelProvidersKey) =>
        atomWithQuery((get) => {
            const projectId = get(projectIdAtom) as string
            return {
                queryKey: ["analytics", "modelProviders", projectId, key.window, key.filters],
                queryFn: async ({signal}) => {
                    const base = {projectId, window: key.window, filters: key.filters, signal}
                    const keysOf = async (
                        name: AnalyticsQueryName,
                        path: string,
                        focus?: AnalyticsFocus,
                    ) =>
                        Object.keys(
                            keyedSeries(
                                key.window,
                                await fetchAnalyticsBuckets({...base, name, focus}),
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

export interface AnalyticsRunsKey {
    window: AnalyticsWindow
    filters: AnalyticsFilters
    focus?: AnalyticsFocus | null
    failedOnly: boolean
    limit: number
}

export const analyticsRunsAtomFamily = atomFamily(
    (key: AnalyticsRunsKey) =>
        atomWithQuery((get) => {
            const projectId = get(projectIdAtom)
            return {
                queryKey: ["analytics", "runs", projectId, key],
                queryFn: async (): Promise<AnalyticsRun[]> =>
                    (await fetchAnalyticsRunSpans({projectId: projectId as string, ...key})).map(
                        toAnalyticsRun,
                    ),
                enabled: Boolean(projectId),
                ...QUERY_OPTIONS,
            }
        }),
    isEqual,
)

/** Tool calls of the runs on screen, to show call counts and which calls failed. */
export const analyticsRunToolsAtomFamily = atomFamily(
    (traceIds: string[]) =>
        atomWithQuery((get) => {
            const projectId = get(projectIdAtom)
            return {
                queryKey: ["analytics", "run-tools", projectId, traceIds],
                queryFn: async (): Promise<Record<string, AnalyticsRunTools>> =>
                    toolsByRun(await fetchAnalyticsToolSpans(projectId as string, traceIds)),
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
export const analyticsAgentNamesAtomFamily = atomFamily(
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

export const analyticsHasAgentsAtom = atom((get) => {
    const state = get(agentWorkflowsListQueryStateAtom)
    return {pending: state.isPending, failed: state.isError, hasAgents: state.data.length > 0}
})

export interface AnalyticsDrawerState {
    /** A bucket of the page window, or null for the whole window. */
    bucket: number | null
    metric: AnalyticsMetric
    dim: AnalyticsDimension
    focus: AnalyticsFocus | null
    failedOnly: boolean
}

export const analyticsDrawerAtom = atom<AnalyticsDrawerState | null>(null)
