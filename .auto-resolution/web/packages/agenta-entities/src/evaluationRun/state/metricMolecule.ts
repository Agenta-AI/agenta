/**
 * evaluationMetricMolecule — minimal entity layer for per-scenario metrics.
 *
 * Same shape as `evaluationResultMolecule`. Metrics are read-only from the
 * UI's perspective. Cache key: `["evaluation-metrics", projectId, runId, scenarioId]`.
 * Value: `EvaluationMetric[]` (typically one per scenario, but the API
 * doesn't constrain it — could be multiple).
 *
 * @packageDocumentation
 */

import {getDefaultStore} from "jotai/vanilla"
import {queryClientAtom} from "jotai-tanstack-query"

import {queryEvaluationMetrics} from "../api"
import type {EvaluationMetric} from "../core"

const KEY_PREFIX = "evaluation-metrics"

function cacheKey(projectId: string, runId: string, scenarioId: string) {
    return [KEY_PREFIX, projectId, runId, scenarioId] as const
}

function getQc() {
    return getDefaultStore().get(queryClientAtom)
}

export interface PrefetchMetricsArgs {
    projectId: string
    runId: string
    scenarioIds: string[]
}

export interface PrefetchMetricsOutcome {
    metrics: EvaluationMetric[]
    byScenarioId: Map<string, EvaluationMetric[]>
    cacheHits: number
    cacheMisses: number
    fetchMs: number
}

export const evaluationMetricMolecule = {
    get: {
        byScenario(args: {
            projectId: string
            runId: string
            scenarioId: string
        }): EvaluationMetric[] | null {
            try {
                return (
                    getQc().getQueryData<EvaluationMetric[]>(
                        cacheKey(args.projectId, args.runId, args.scenarioId),
                    ) ?? null
                )
            } catch {
                return null
            }
        },
    },

    actions: {
        async prefetchByScenarioIds(args: PrefetchMetricsArgs): Promise<PrefetchMetricsOutcome> {
            const {projectId, runId, scenarioIds} = args
            if (scenarioIds.length === 0) {
                return {
                    metrics: [],
                    byScenarioId: new Map(),
                    cacheHits: 0,
                    cacheMisses: 0,
                    fetchMs: 0,
                }
            }

            let qc: ReturnType<typeof getQc> | null = null
            try {
                qc = getQc()
            } catch {}

            const byScenarioId = new Map<string, EvaluationMetric[]>()
            const misses: string[] = []
            let hits = 0

            if (qc) {
                for (const sid of scenarioIds) {
                    const cached = qc.getQueryData<EvaluationMetric[]>(
                        cacheKey(projectId, runId, sid),
                    )
                    if (cached !== undefined) {
                        byScenarioId.set(sid, cached)
                        hits++
                    } else {
                        misses.push(sid)
                    }
                }
            } else {
                misses.push(...scenarioIds)
            }

            let fetchMs = 0
            if (misses.length > 0) {
                const start = performance.now()
                const fetched = await queryEvaluationMetrics({
                    projectId,
                    runId,
                    scenarioIds: misses,
                })
                fetchMs = performance.now() - start

                for (const m of fetched) {
                    if (!m.scenario_id) continue // run-level aggregates have no scenario_id
                    const arr = byScenarioId.get(m.scenario_id) ?? []
                    arr.push(m)
                    byScenarioId.set(m.scenario_id, arr)
                }
                if (qc) {
                    for (const sid of misses) {
                        qc.setQueryData(
                            cacheKey(projectId, runId, sid),
                            byScenarioId.get(sid) ?? [],
                        )
                    }
                }
            }

            const flat: EvaluationMetric[] = []
            byScenarioId.forEach((arr) => flat.push(...arr))

            return {
                metrics: flat,
                byScenarioId,
                cacheHits: hits,
                cacheMisses: misses.length,
                fetchMs,
            }
        },

        invalidate(args: {projectId: string; runId: string; scenarioId: string}): void {
            try {
                getQc().removeQueries({
                    queryKey: cacheKey(args.projectId, args.runId, args.scenarioId),
                })
            } catch {}
        },

        /**
         * Bulk-evict every cached metric for a run. See resultMolecule for
         * rationale. Returns the count of removed entries.
         */
        evictByRunId(args: {projectId: string; runId: string}): number {
            try {
                const cache = getQc().getQueryCache()
                const toRemove = cache.findAll({
                    queryKey: [KEY_PREFIX, args.projectId, args.runId],
                    exact: false,
                })
                toRemove.forEach((q) => cache.remove(q))
                return toRemove.length
            } catch {
                return 0
            }
        },

        /**
         * Bulk-evict cached metrics for a specific set of scenarios — the
         * per-chunk counterpart of `prefetchByScenarioIds`. See
         * `evaluationResultMolecule.actions.evictByScenarioIds` for the
         * rationale. Returns the count of entries removed.
         */
        evictByScenarioIds(args: {
            projectId: string
            runId: string
            scenarioIds: string[]
        }): number {
            let removed = 0
            try {
                const qc = getQc()
                for (const sid of args.scenarioIds) {
                    const key = cacheKey(args.projectId, args.runId, sid)
                    if (qc.getQueryData(key) !== undefined) {
                        qc.removeQueries({queryKey: key, exact: true})
                        removed++
                    }
                }
            } catch {
                // No queryClient — nothing to evict.
            }
            return removed
        },
    },

    _internal: {cacheKey},
}

export type EvaluationMetricMolecule = typeof evaluationMetricMolecule
