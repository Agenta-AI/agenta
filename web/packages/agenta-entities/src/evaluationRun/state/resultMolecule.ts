/**
 * evaluationResultMolecule — minimal entity layer for evaluation results.
 *
 * Results are *read-only* from the UI's perspective (the user doesn't edit
 * a result; the eval engine produces them). So this molecule's surface is
 * tiny:
 *
 *   .get.byScenario(args)                   imperative cache read
 *   .actions.prefetchByScenarioIds(args)    cache-aware bulk fetch
 *   .actions.invalidate(args)               drop a scenario's cache entry
 *
 * # Cache identity
 *
 * Uses the shared Jotai `queryClientAtom`, same store every other molecule
 * uses. Cache key: `["evaluation-results", projectId, runId, scenarioId]`.
 * The value at each key is `EvaluationResult[]` (the steps for that scenario).
 *
 * Empty arrays are cached too. A scenario with no results yet (run still in
 * progress) returns `[]` from cache rather than refetching every time.
 *
 * # Why the molecule name doesn't follow `*Molecule` exactly
 *
 * Existing molecules (testcase, trace) wrap `createMolecule` which provides
 * drafts, controllers, selection, etc. — appropriate for editable entities.
 * Results have no edit surface, so we skip the heavy infrastructure. The
 * shape (`.get.*`, `.actions.*`) still matches the convention so callers
 * read consistently across molecules.
 *
 * @packageDocumentation
 */

import {getDefaultStore} from "jotai/vanilla"
import {queryClientAtom} from "jotai-tanstack-query"

import {queryEvaluationResults} from "../api"
import type {EvaluationResult} from "../core"

const KEY_PREFIX = "evaluation-results"

function cacheKey(projectId: string, runId: string, scenarioId: string) {
    return [KEY_PREFIX, projectId, runId, scenarioId] as const
}

function getQc() {
    return getDefaultStore().get(queryClientAtom)
}

export interface PrefetchResultsArgs {
    projectId: string
    runId: string
    scenarioIds: string[]
}

export interface PrefetchResultsOutcome {
    /** All results, ungrouped (cached + freshly fetched). */
    results: EvaluationResult[]
    /** Results grouped by scenario_id. */
    byScenarioId: Map<string, EvaluationResult[]>
    cacheHits: number
    cacheMisses: number
    /** Network time for the bulk fetch; 0 if all scenarios were cached. */
    fetchMs: number
}

export const evaluationResultMolecule = {
    get: {
        /**
         * Synchronous cache lookup. Returns `null` if the scenario hasn't been
         * prefetched yet (caller should fall back to a prefetch).
         */
        byScenario(args: {
            projectId: string
            runId: string
            scenarioId: string
        }): EvaluationResult[] | null {
            try {
                return (
                    getQc().getQueryData<EvaluationResult[]>(
                        cacheKey(args.projectId, args.runId, args.scenarioId),
                    ) ?? null
                )
            } catch {
                return null
            }
        },
    },

    actions: {
        /**
         * Cache-aware bulk prefetch. Steps:
         *   1. partition input scenarioIds into hits vs misses
         *   2. POST /evaluations/results/query with the misses only
         *   3. group fetched rows by scenario_id
         *   4. write cache entries for every miss (including empties)
         *   5. return cached + fetched together
         */
        async prefetchByScenarioIds(args: PrefetchResultsArgs): Promise<PrefetchResultsOutcome> {
            const {projectId, runId, scenarioIds} = args
            if (scenarioIds.length === 0) {
                return {
                    results: [],
                    byScenarioId: new Map(),
                    cacheHits: 0,
                    cacheMisses: 0,
                    fetchMs: 0,
                }
            }

            let qc: ReturnType<typeof getQc> | null = null
            try {
                qc = getQc()
            } catch {
                // No queryClient available — degrade to full fetch
            }

            const byScenarioId = new Map<string, EvaluationResult[]>()
            const misses: string[] = []
            let hits = 0

            if (qc) {
                for (const sid of scenarioIds) {
                    const cached = qc.getQueryData<EvaluationResult[]>(
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
                const fetched = await queryEvaluationResults({
                    projectId,
                    runId,
                    scenarioIds: misses,
                })
                fetchMs = performance.now() - start

                // Group by scenario_id
                for (const r of fetched) {
                    const arr = byScenarioId.get(r.scenario_id) ?? []
                    arr.push(r)
                    byScenarioId.set(r.scenario_id, arr)
                }
                // Write cache for every miss — including empty arrays for
                // scenarios with no rows yet (so we don't re-fetch them).
                if (qc) {
                    for (const sid of misses) {
                        qc.setQueryData(
                            cacheKey(projectId, runId, sid),
                            byScenarioId.get(sid) ?? [],
                        )
                    }
                }
            }

            // Flatten ordered output
            const flat: EvaluationResult[] = []
            byScenarioId.forEach((arr) => flat.push(...arr))

            return {
                results: flat,
                byScenarioId,
                cacheHits: hits,
                cacheMisses: misses.length,
                fetchMs,
            }
        },

        /** Drop a scenario's cache entry — next read will refetch. */
        invalidate(args: {projectId: string; runId: string; scenarioId: string}): void {
            try {
                getQc().removeQueries({
                    queryKey: cacheKey(args.projectId, args.runId, args.scenarioId),
                })
            } catch {
                // No queryClient
            }
        },

        /**
         * Bulk-evict every cached result for a run. Use this after finishing a
         * long-running ETL pass to release memory — cache entries don't have
         * subscribers in a script context, so TanStack's default gcTime never
         * fires and entries accumulate.
         *
         * Returns the number of cache entries removed.
         */
        evictByRunId(args: {projectId: string; runId: string}): number {
            try {
                // Prefix match: every key starts with `[KEY_PREFIX, projectId, runId, ...]`
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
         * Bulk-evict cached results for a specific set of scenarios — the
         * per-chunk counterpart of `prefetchByScenarioIds`. An ETL
         * chunk-release hook (see `ChunkReleaseHook`) calls this once the
         * sink has consumed a chunk, so heap stays bounded by chunk size
         * across an arbitrarily long scan instead of growing with the
         * dataset.
         *
         * Returns the number of cache entries actually removed.
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

    /** Exposed for test code only — don't depend on this from app code. */
    _internal: {cacheKey},
}

export type EvaluationResultMolecule = typeof evaluationResultMolecule
