/**
 * Molecule-backed `HydrateFetchers` — the proper entity-layer integration.
 *
 * Each of the four entity types the hydrate transform needs now has a
 * cache-aware prefetch action on (or alongside) its molecule:
 *
 *   - results    →  evaluationResultMolecule.actions.prefetchByScenarioIds
 *   - metrics    →  evaluationMetricMolecule.actions.prefetchByScenarioIds
 *   - testcases  →  prefetchTestcasesByIds (testcase/state/prefetch)
 *   - traces     →  prefetchTracesByIds   (trace/state/prefetch)
 *
 * Every action:
 *   1. Reads from the shared TanStack Query cache for each requested id
 *   2. Bulk-fetches only the misses
 *   3. Writes new rows back to cache (including empties, so we don't
 *      re-fetch scenarios that genuinely have no data)
 *   4. Returns a `{cacheHits, cacheMisses, fetchMs}` stat block
 *
 * The hydrate transform doesn't need to know any of this — it just calls
 * `fetchers.fetch*` and receives `HydrateFetchers`-shaped output. The
 * adapter here glues the molecule outcomes (rich) to the fetcher
 * contract (flat) and emits cache stats via `onCacheStats` if provided.
 *
 * @packageDocumentation
 */

import {prefetchTestcasesByIds} from "../../testcase/state/prefetch"
import {prefetchTracesByIds} from "../../trace/state/prefetch"
import {evaluationMetricMolecule} from "../state/metricMolecule"
import {evaluationResultMolecule} from "../state/resultMolecule"

import type {HydrateFetchers} from "./hydrateScenariosTransform"

/**
 * Stats one entity type emitted during a single chunk hydration.
 */
export interface EntityCacheStats {
    cacheHits: number
    cacheMisses: number
    fetchMs: number
}

/**
 * Per-chunk cache stats across all four entity types.
 */
export interface ChunkCacheStats {
    results: EntityCacheStats
    metrics: EntityCacheStats
    testcases: EntityCacheStats
    traces: EntityCacheStats
}

export interface BuildMoleculeFetchersOptions {
    /**
     * Optional sink for per-chunk cache stats. Called exactly once per
     * `fetch*` invocation. Use to surface cache hit ratios in observability.
     */
    onCacheStats?: (entity: keyof ChunkCacheStats, stats: EntityCacheStats) => void
}

/**
 * Build a HydrateFetchers that routes every fetch through the molecule
 * layer. Each call emits cache stats via the optional callback.
 */
export function buildMoleculeBackedFetchers(
    options: BuildMoleculeFetchersOptions = {},
): HydrateFetchers {
    const emit = options.onCacheStats

    return {
        fetchResults: async ({projectId, runId, scenarioIds}) => {
            const out = await evaluationResultMolecule.actions.prefetchByScenarioIds({
                projectId,
                runId,
                scenarioIds,
            })
            emit?.("results", {
                cacheHits: out.cacheHits,
                cacheMisses: out.cacheMisses,
                fetchMs: out.fetchMs,
            })
            return out.results
        },

        fetchMetrics: async ({projectId, runId, scenarioIds}) => {
            const out = await evaluationMetricMolecule.actions.prefetchByScenarioIds({
                projectId,
                runId,
                scenarioIds,
            })
            emit?.("metrics", {
                cacheHits: out.cacheHits,
                cacheMisses: out.cacheMisses,
                fetchMs: out.fetchMs,
            })
            return out.metrics
        },

        fetchTestcases: async ({projectId, testcaseIds}) => {
            const out = await prefetchTestcasesByIds({projectId, testcaseIds})
            emit?.("testcases", {
                cacheHits: out.cacheHits,
                cacheMisses: out.cacheMisses,
                fetchMs: out.fetchMs,
            })
            return out.testcases
        },

        fetchTraces: async ({projectId, traceIds}) => {
            const out = await prefetchTracesByIds({projectId, traceIds})
            emit?.("traces", {
                cacheHits: out.cacheHits,
                cacheMisses: out.cacheMisses,
                fetchMs: out.fetchMs,
            })
            // Pass the TracesApiResponse envelope through unchanged. The
            // envelope shape `{count, traces: {[traceIdNoDashes]: traceData}}`
            // is the documented contract for the shared
            // `["trace-entity", projectId, traceId]` cache key and is what
            // every other consumer (traceEntityAtomFamily, EvalRunDetails)
            // expects. `findInTrace` knows how to drill through it
            // (resolveMappings.ts case 3), so the hydrate pipeline doesn't
            // need to pre-unwrap.
            const flat = new Map<string, unknown>()
            out.traces.forEach((envelope, traceId) => flat.set(traceId, envelope))
            return flat
        },
    }
}

/**
 * Default cache-aware fetchers (no stats emission). For the common case
 * where you just want cache integration without observability.
 */
export const MOLECULE_BACKED_HYDRATE_FETCHERS: HydrateFetchers = buildMoleculeBackedFetchers()

/**
 * @deprecated Use `MOLECULE_BACKED_HYDRATE_FETCHERS` instead. Kept for one
 * release as an alias so PoC scripts don't break.
 */
export const CACHE_AWARE_HYDRATE_FETCHERS = MOLECULE_BACKED_HYDRATE_FETCHERS

// Backward-compat re-export — the old single-fn API still exists.
export {prefetchTestcasesByIds as cacheAwareFetchTestcases}
