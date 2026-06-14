/* eslint-disable @typescript-eslint/no-explicit-any -- relocated eval-run parity data layer (WP-4e-2b); reads dynamic backend-shaped payloads, logic unchanged */
import {axios} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {createBatchFetcher, type BatchFetcher} from "@agenta/shared/utils"
import deepEqual from "fast-deep-equal"
import {atom, getDefaultStore} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {deriveEvaluationKind} from "../../../core"
import {previewEvalTypeAtom} from "../state/evalType"

import {isTerminalStatus} from "./compare"
import {createMetricProcessor} from "./metricProcessor"
import {
    buildGroupedMetrics,
    extractMetricValueFromData,
    type ScenarioMetricData,
} from "./metricsCompute"
import {activePreviewRunIdAtom, effectiveProjectIdAtom} from "./run"
import {evaluationRunQueryAtomFamily} from "./table/run"

export type {ScenarioMetricData} from "./metricsCompute"

const metricBatcherCache = new Map<string, BatchFetcher<string, ScenarioMetricData | null>>()

/**
 * Module-level cache for scenario statuses.
 * This is populated when scenarios are loaded and read by the metric batcher
 * to determine if a scenario is in a terminal state when metrics are missing.
 */
const scenarioStatusCache = new Map<string, string | null>()

/**
 * Track scenarios that have recently had metrics saved.
 * This prevents triggering a refresh immediately after saving when the
 * scenario is in terminal state but metrics haven't been persisted yet.
 */
const recentlySavedScenarios = new Set<string>()
const RECENTLY_SAVED_TTL_MS = 10_000 // 10 seconds

/**
 * Update the scenario status cache with new scenario data.
 * Call this when scenarios are loaded to make statuses available for metric refresh logic.
 */
export const updateScenarioStatusCache = (scenarios: {id: string; status?: string | null}[]) => {
    scenarios.forEach((scenario) => {
        if (scenario.id) {
            scenarioStatusCache.set(scenario.id, scenario.status ?? null)
        }
    })
}

/**
 * Mark a scenario as recently saved to prevent immediate refresh.
 * Call this after saving annotations/metrics to prevent the refresh logic
 * from triggering before the new data is persisted.
 */
export const markScenarioAsRecentlySaved = (scenarioId: string) => {
    recentlySavedScenarios.add(scenarioId)
    // Auto-clear after TTL
    setTimeout(() => {
        recentlySavedScenarios.delete(scenarioId)
    }, RECENTLY_SAVED_TTL_MS)
}

/**
 * Check if a scenario was recently saved (within TTL).
 */
export const wasScenarioRecentlySaved = (scenarioId: string): boolean => {
    return recentlySavedScenarios.has(scenarioId)
}

/**
 * Get scenario statuses for a list of scenario IDs from the cache.
 */
export const getScenarioStatuses = (scenarioIds: string[]): Map<string, string | null> => {
    const result = new Map<string, string | null>()
    scenarioIds.forEach((id) => {
        if (scenarioStatusCache.has(id)) {
            result.set(id, scenarioStatusCache.get(id) ?? null)
        }
    })
    return result
}

/**
 * Clear the scenario status cache.
 * Call this when projectId/workspace changes.
 */
export const clearScenarioStatusCache = () => {
    scenarioStatusCache.clear()
    recentlySavedScenarios.clear()
}

/**
 * Invalidate the metric batcher cache.
 * Call this after updating metrics to force a fresh fetch.
 */
export const invalidateMetricBatcherCache = () => {
    metricBatcherCache.clear()
}

const resolveEffectiveRunId = (get: any, runId?: string | null) =>
    runId ?? get(activePreviewRunIdAtom) ?? undefined

const resolveProjectId = (get: any) => {
    const projectId = get(effectiveProjectIdAtom)
    if (projectId) return projectId
    const globalProjectId = getDefaultStore().get(projectIdAtom)
    return globalProjectId ?? null
}

export const evaluationMetricBatcherFamily = atomFamily(({runId}: {runId?: string | null} = {}) =>
    atom((get) => {
        const projectId = resolveProjectId(get)
        const effectiveRunId = resolveEffectiveRunId(get, runId)
        const evalTypeFromAtom = get(previewEvalTypeAtom)

        // Derive evaluation type from run.data.steps - this is the reliable source of truth
        // Do NOT use meta.evaluation_kind as it's flaky and unreliable
        const runQuery = effectiveRunId
            ? get(evaluationRunQueryAtomFamily(effectiveRunId))
            : undefined
        const rawRun = runQuery?.data?.rawRun
        const evalTypeFromRun = rawRun ? deriveEvaluationKind(rawRun) : null
        const evaluationType = evalTypeFromAtom || evalTypeFromRun

        if (!projectId || !effectiveRunId) return null

        const cacheKey = `${projectId}:${effectiveRunId}:${evaluationType || "auto"}`
        let batcher = metricBatcherCache.get(cacheKey)
        if (!batcher) {
            metricBatcherCache.clear()
            batcher = createBatchFetcher<string, ScenarioMetricData | null>({
                serializeKey: (key) => key,
                batchFn: async (scenarioIds) => {
                    const unique = Array.from(new Set(scenarioIds.filter(Boolean)))
                    if (!unique.length) {
                        return {}
                    }

                    const fetchMetrics = async () => {
                        const metricPayload: Record<string, any> = {}
                        // metricPayload.run_id = effectiveRunId
                        if (unique.length) {
                            // For scenario-scoped queries, do not constrain by run_ids to avoid over-filtering.
                            metricPayload.scenario_ids = unique
                        } else {
                            metricPayload.run_ids = [effectiveRunId]
                        }

                        const response = await axios.post(
                            `/evaluations/metrics/query`,
                            {
                                metrics: {
                                    ...metricPayload,
                                },
                            },
                            {
                                params: {project_id: projectId},
                            },
                        )

                        return Array.isArray(response.data?.metrics) ? response.data.metrics : []
                    }

                    const resolveMetrics = async (): Promise<
                        Record<string, ScenarioMetricData | null>
                    > => {
                        const processMetrics = async ({
                            entries,
                            source,
                            triggerRefresh,
                        }: {
                            entries: any[]
                            source: string
                            triggerRefresh: boolean
                        }) => {
                            const processor = createMetricProcessor({
                                projectId,
                                runId: effectiveRunId,
                                source,
                                evaluationType,
                            })

                            // Get scenario statuses from cache for terminal state detection
                            const scenarioStatuses = getScenarioStatuses(unique)

                            const grouped = buildGroupedMetrics(
                                unique,
                                entries,
                                processor,
                                scenarioStatuses,
                            )
                            const flushResult = await processor.flush({triggerRefresh})
                            return {grouped, flushResult}
                        }

                        const initial = await processMetrics({
                            entries: await fetchMetrics(),
                            source: "scenario-metric-batcher",
                            triggerRefresh: true,
                        })

                        let grouped = initial.grouped
                        let flushResult = initial.flushResult

                        // Re-fetch after refresh to get updated metrics
                        if (flushResult.refreshed) {
                            const retry = await processMetrics({
                                entries: await fetchMetrics(),
                                source: "scenario-metric-batcher:retry",
                                triggerRefresh: false,
                            })

                            grouped = retry.grouped
                        }

                        return grouped
                    }

                    return resolveMetrics()
                },
            })
            metricBatcherCache.set(cacheKey, batcher)
        }

        return batcher
    }),
)

export const evaluationMetricBatcherAtom = atom((get) => get(evaluationMetricBatcherFamily({})))

export const evaluationMetricQueryAtomFamily = atomFamily(
    ({scenarioId, runId}: {scenarioId: string; runId?: string | null}) =>
        atomWithQuery<ScenarioMetricData | null>((get) => {
            const effectiveRunId = resolveEffectiveRunId(get, runId)
            const batcher = get(evaluationMetricBatcherFamily({runId: effectiveRunId}))
            const projectId = resolveProjectId(get)

            // While the run is still executing, poll so a completing
            // scenario's metrics surface in the table cells + focus drawer
            // without a manual reload. Stops once the run is terminal.
            const runQuery = effectiveRunId
                ? get(evaluationRunQueryAtomFamily(effectiveRunId))
                : undefined
            const runStatus = runQuery?.data?.rawRun?.status ?? runQuery?.data?.camelRun?.status
            const runTerminal = isTerminalStatus(runStatus)

            return {
                queryKey: ["preview", "evaluation-metric", effectiveRunId, projectId, scenarioId],
                enabled: Boolean(projectId && effectiveRunId && batcher && scenarioId),
                staleTime: 30_000,
                gcTime: 5 * 60 * 1000,
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
                refetchInterval: runTerminal ? false : 5000,
                // Enable structural sharing to prevent unnecessary re-renders when data hasn't changed
                structuralSharing: true,
                queryFn: async () => {
                    if (!batcher) {
                        throw new Error("Metric batcher is not initialised")
                    }
                    const value = await batcher(scenarioId)
                    return value ?? null
                },
            }
        }),
)

export const scenarioMetricValueAtomFamily = atomFamily(
    (args: {
        scenarioId: string
        path: string
        metricKey?: string
        stepKey?: string
        evaluatorId?: string | null
        evaluatorSlug?: string | null
        runId?: string | null
        columnId?: string
    }) =>
        selectAtom(
            evaluationMetricQueryAtomFamily({
                scenarioId: args.scenarioId,
                runId: args.runId,
            }),
            (queryState) => {
                const data = extractMetricValueFromData(
                    queryState.data,
                    args.path,
                    args.metricKey,
                    args.stepKey,
                    args.evaluatorSlug ?? args.evaluatorId ?? null,
                    {
                        scenarioId: args.scenarioId,
                        runId: args.runId,
                        columnId: args.columnId,
                        evaluatorKey: args.evaluatorSlug ?? args.evaluatorId ?? null,
                        metricKey: args.metricKey,
                        path: args.path,
                        stepKey: args.stepKey,
                    },
                )

                return data
            },
            deepEqual,
        ),
)

export const scenarioMetricMetaAtomFamily = atomFamily(
    ({scenarioId, runId}: {scenarioId: string; runId?: string | null}) =>
        selectAtom(
            evaluationMetricQueryAtomFamily({scenarioId, runId}),
            (queryState) => {
                // Stale-while-revalidate: only show loading when there's no cached data
                const hasData = Boolean(queryState.data)
                return {
                    isLoading: !hasData && queryState.isLoading,
                    isFetching: queryState.isFetching,
                    error: queryState.error,
                }
            },
            (a, b) =>
                a.isLoading === b.isLoading && a.isFetching === b.isFetching && a.error === b.error,
        ),
)

/**
 * Trigger metrics refresh for both scenario-level and run-level metrics.
 * This should be called after actions that modify scenario data (invocations, annotations).
 *
 * @param projectId - The project ID
 * @param runId - The run ID
 * @param scenarioId - Optional scenario ID for scenario-level refresh
 */
export const triggerMetricsRefresh = async ({
    projectId,
    runId,
    scenarioId,
}: {
    projectId: string
    runId: string
    scenarioId?: string
}): Promise<void> => {
    try {
        // Refresh scenario-level metrics if scenarioId is provided
        if (scenarioId) {
            await axios.post(
                `/evaluations/metrics/refresh`,
                {
                    metrics: {
                        run_id: runId,
                        scenario_id: scenarioId,
                    },
                },
                {params: {project_id: projectId}},
            )
        }
        // Refresh run-level metrics (without scenario_id)
        await axios.post(
            `/evaluations/metrics/refresh`,
            {
                metrics: {
                    run_id: runId,
                },
            },
            {params: {project_id: projectId}},
        )
        console.log("[metrics] Metrics refresh triggered", {
            projectId,
            runId,
            scenarioId,
            levels: scenarioId ? "scenario + run" : "run only",
        })
    } catch (error) {
        console.warn("[metrics] Metrics refresh failed:", error)
    }
}
