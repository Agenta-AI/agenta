/**
 * createScenarioCacheMolecule — shared factory for the read-only, per-scenario
 * cache molecules in the evaluation-run domain.
 *
 * `evaluationResultMolecule` and `evaluationMetricMolecule` are byte-for-byte
 * the same cache machinery — only the cache-key prefix, the element type, the
 * fetcher, and the flat-array field name on the outcome differ. This factory
 * captures that machinery once so the two molecules stay in lock-step.
 *
 * # Cache identity
 *
 * Uses the shared Jotai `queryClientAtom`, same store every other molecule
 * uses. Cache key: `[keyPrefix, projectId, runId, scenarioId]`. The value at
 * each key is `T[]` (the rows for that scenario). Empty arrays are cached too,
 * so a scenario with no rows yet (run still in progress) returns `[]` from
 * cache rather than refetching every time.
 *
 * # Why not `createMolecule`
 *
 * The heavyweight `createMolecule` provides drafts, controllers, selection,
 * etc. — appropriate for editable entities. Results/metrics are read-only from
 * the UI's perspective (the eval engine produces them; the user never edits
 * one), so this skips that infrastructure. The shape (`.get.*`, `.actions.*`)
 * still matches the convention so callers read consistently across molecules.
 *
 * @packageDocumentation
 */

import {getDefaultStore} from "jotai/vanilla"
import {queryClientAtom} from "jotai-tanstack-query"

/** Args shared by every per-scenario prefetch. */
export interface PrefetchScenarioArgs {
    projectId: string
    runId: string
    scenarioIds: string[]
}

/** Fields every prefetch outcome carries, regardless of element type. */
export interface ScenarioCacheOutcomeBase<T> {
    /** Rows grouped by scenario_id (cached + freshly fetched). */
    byScenarioId: Map<string, T[]>
    cacheHits: number
    cacheMisses: number
    /** Network time for the bulk fetch; 0 if all scenarios were cached. */
    fetchMs: number
}

/**
 * Full prefetch outcome: the base fields plus a domain-named flat array under
 * `K` (e.g. `results` or `metrics`) so the two molecules keep their original
 * public outcome shape.
 */
export type ScenarioCacheOutcome<T, K extends string> = ScenarioCacheOutcomeBase<T> & Record<K, T[]>

interface ScenarioCacheMoleculeConfig<T, K extends string> {
    /** First segment of the TanStack cache key (e.g. `"evaluation-results"`). */
    keyPrefix: string
    /** Name of the flat-array field on the prefetch outcome (e.g. `"results"`). */
    listKey: K
    /** Bulk fetcher for the cache misses. */
    fetch: (args: PrefetchScenarioArgs) => Promise<T[]>
    /** Extract a row's scenario_id (may be absent for run-level aggregates). */
    getScenarioId: (item: T) => string | null | undefined
    /**
     * Drop rows whose scenario_id is missing instead of grouping them. Needed
     * for metrics, where run-level aggregates carry a null scenario_id.
     */
    skipItemsWithoutScenarioId?: boolean
}

export function createScenarioCacheMolecule<T, K extends string>(
    config: ScenarioCacheMoleculeConfig<T, K>,
) {
    const {keyPrefix, listKey, fetch, getScenarioId, skipItemsWithoutScenarioId} = config

    function cacheKey(projectId: string, runId: string, scenarioId: string) {
        return [keyPrefix, projectId, runId, scenarioId] as const
    }

    function getQc() {
        return getDefaultStore().get(queryClientAtom)
    }

    type Outcome = ScenarioCacheOutcome<T, K>

    const emptyOutcome = (): Outcome =>
        ({
            byScenarioId: new Map<string, T[]>(),
            cacheHits: 0,
            cacheMisses: 0,
            fetchMs: 0,
            [listKey]: [] as T[],
        }) as Outcome

    return {
        get: {
            /**
             * Synchronous cache lookup. Returns `null` if the scenario hasn't
             * been prefetched yet (caller should fall back to a prefetch).
             */
            byScenario(args: {projectId: string; runId: string; scenarioId: string}): T[] | null {
                try {
                    return (
                        getQc().getQueryData<T[]>(
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
             *   2. fetch the misses only
             *   3. group fetched rows by scenario_id
             *   4. write cache entries for every miss (including empties)
             *   5. return cached + fetched together
             */
            async prefetchByScenarioIds(args: PrefetchScenarioArgs): Promise<Outcome> {
                const {projectId, runId, scenarioIds} = args
                if (scenarioIds.length === 0) return emptyOutcome()

                let qc: ReturnType<typeof getQc> | null = null
                try {
                    qc = getQc()
                } catch {
                    // No queryClient available — degrade to full fetch.
                }

                const byScenarioId = new Map<string, T[]>()
                const misses: string[] = []
                let hits = 0

                if (qc) {
                    for (const sid of scenarioIds) {
                        const cached = qc.getQueryData<T[]>(cacheKey(projectId, runId, sid))
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
                    const fetched = await fetch({projectId, runId, scenarioIds: misses})
                    fetchMs = performance.now() - start

                    // Group by scenario_id.
                    for (const item of fetched) {
                        const sid = getScenarioId(item)
                        if (sid == null || sid === "") {
                            if (skipItemsWithoutScenarioId) continue
                        }
                        const key = sid as string
                        const arr = byScenarioId.get(key) ?? []
                        arr.push(item)
                        byScenarioId.set(key, arr)
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

                // Flatten ordered output.
                const flat: T[] = []
                byScenarioId.forEach((arr) => flat.push(...arr))

                return {
                    byScenarioId,
                    cacheHits: hits,
                    cacheMisses: misses.length,
                    fetchMs,
                    [listKey]: flat,
                } as Outcome
            },

            /** Drop a scenario's cache entry — next read will refetch. */
            invalidate(args: {projectId: string; runId: string; scenarioId: string}): void {
                try {
                    getQc().removeQueries({
                        queryKey: cacheKey(args.projectId, args.runId, args.scenarioId),
                    })
                } catch {
                    // No queryClient.
                }
            },

            /**
             * Bulk-evict every cached entry for a run. Use this after finishing
             * a long-running ETL pass to release memory — cache entries don't
             * have subscribers in a script context, so TanStack's default
             * gcTime never fires and entries accumulate.
             *
             * Returns the number of cache entries removed.
             */
            evictByRunId(args: {projectId: string; runId: string}): number {
                try {
                    // Prefix match: every key starts with `[keyPrefix, projectId, runId, ...]`.
                    const cache = getQc().getQueryCache()
                    const toRemove = cache.findAll({
                        queryKey: [keyPrefix, args.projectId, args.runId],
                        exact: false,
                    })
                    toRemove.forEach((q) => cache.remove(q))
                    return toRemove.length
                } catch {
                    return 0
                }
            },

            /**
             * Bulk-evict cached entries for a specific set of scenarios — the
             * per-chunk counterpart of `prefetchByScenarioIds`. An ETL
             * chunk-release hook calls this once the sink has consumed a chunk,
             * so heap stays bounded by chunk size across an arbitrarily long
             * scan instead of growing with the dataset.
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
}
