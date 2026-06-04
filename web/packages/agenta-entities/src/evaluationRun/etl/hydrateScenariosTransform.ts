/**
 * hydrateScenariosTransform — joins scenarios with their correlated entities.
 *
 * Scenarios as returned by `/evaluations/scenarios/query` are *references*:
 * they carry an id, a status, a run_id, and a testcase_id. To render anything
 * meaningful in the UI (input data, app outputs, evaluator scores, traces) we
 * have to join 4 additional entities, each fetched in bulk by the IDs present
 * in the chunk:
 *
 *   - results   (one per `step_key`):   POST /evaluations/results/query
 *   - metrics   (per-scenario scores):  POST /evaluations/metrics/query
 *   - testcases (input data):           POST /testcases/query
 *   - traces    (app outputs/spans):    POST /tracing/spans/query
 *                                       (filter: trace_id IN [...])
 *
 * This factory returns a `Transform<EvaluationScenario, HydratedScenarioRow>`
 * that runs all four fetches in parallel per chunk. This is what the architecture
 * RFC calls `correlatedDataPrefetch` (Convention 7) — except instead of being
 * a side-effect on chunk arrival, here it's an explicit pipeline stage so the
 * downstream sink receives fully materialized rows.
 *
 * Per-chunk request budget: 4 bulk calls (results, metrics, testcases, traces).
 * Independent of chunk size or column count.
 *
 * Each call uses the **entities-package API surface** (queryEvaluationResults,
 * queryEvaluationMetrics, fetchTestcasesBatch, fetchAllPreviewTraces). That's
 * the load-bearing claim: hydration goes through the same code path as cell
 * rendering, so anything we build here drops straight into a real store.
 *
 * @packageDocumentation
 */

import type {Transform, Chunk} from "../../etl/core/types"
import {fetchTestcasesBatch} from "../../testcase/api"
import type {Testcase} from "../../testcase/core"
import {fetchAllPreviewTraces} from "../../trace/api"
import {queryEvaluationResults, queryEvaluationMetrics} from "../api"
import type {EvaluationResult, EvaluationMetric} from "../core"

/**
 * Minimal scenario shape this transform consumes. The full schema lives in
 * `realScenarioSource.ts` as `RealEvaluationScenario`, but consumers may pass
 * any object that carries an `id` and (optionally) a `testcase_id`.
 */
export interface HydratableScenario {
    id: string
    testcase_id?: string | null
    [k: string]: unknown
}

/**
 * The output of the hydrate transform — a row fully joined to its correlated
 * entities. Sinks that consume this know enough to render any column in the
 * UI without further fetches.
 */
export interface HydratedScenarioRow<TScenario extends HydratableScenario = HydratableScenario> {
    scenario: TScenario
    /** All results (one per step_key) for this scenario. May be empty if the run is still in progress. */
    results: EvaluationResult[]
    /** Per-scenario metrics. Often one row keyed by step_key in `metric.data`, but the API doesn't constrain count. */
    metrics: EvaluationMetric[]
    /** Testcase referenced by scenario.testcase_id. Null if no reference or fetch failed. */
    testcase: Testcase | null
    /** Trace data keyed by trace_id (dashes preserved). May be empty if no result.trace_id existed yet. */
    traces: Record<string, unknown>
}

/**
 * Pluggable fetcher contracts.
 *
 * The hydrate transform doesn't know how to fetch anything — it just describes
 * what it needs (ids in, joined data out). Each fetcher is injected, so the
 * same transform runs against:
 *
 *   - raw HTTP fetchers (Node scripts, ETL)            ← current default
 *   - TanStack-cached fetchers (browser, dedupes)      ← drop-in upgrade
 *   - molecule.actions.prefetchMany(ids) (full entity layer) ← future
 *
 * As entity-layer abstractions land (molecules with prefetch actions,
 * traceBatchFetcher export, etc.), callers swap them in here. The transform
 * doesn't change.
 */
export interface HydrateFetchers {
    /** Bulk fetch results by scenario IDs. */
    fetchResults: (args: {
        projectId: string
        runId: string
        scenarioIds: string[]
    }) => Promise<EvaluationResult[]>
    /** Bulk fetch metrics by scenario IDs. */
    fetchMetrics: (args: {
        projectId: string
        runId: string
        scenarioIds: string[]
    }) => Promise<EvaluationMetric[]>
    /** Bulk fetch testcases by IDs. Returns Map<id, Testcase>. */
    fetchTestcases: (args: {
        projectId: string
        testcaseIds: string[]
    }) => Promise<Map<string, Testcase>>
    /**
     * Bulk fetch traces by IDs. Returns Map<traceId (dashed), traceEnvelope>.
     * Implementations are responsible for any ID canonicalisation.
     */
    fetchTraces: (args: {projectId: string; traceIds: string[]}) => Promise<Map<string, unknown>>
}

export interface HydrateScenariosTransformParams {
    /** Project scope for all sub-fetches. */
    projectId: string
    /** Run scope for results + metrics queries. */
    runId: string
    /**
     * Override individual fetchers. Anything you don't pass falls back to
     * the API-direct defaults (raw HTTP, no entity-cache integration). Use
     * this slot to plug in molecule-backed or batch-fetcher-backed versions
     * once they exist.
     */
    fetchers?: Partial<HydrateFetchers>
    /**
     * Skip the trace fetch. Useful when the pipeline only needs scores +
     * input data (e.g. for table summary rendering) and traces are drilled
     * into on demand. Defaults to false (traces are fetched).
     */
    skipTraces?: boolean
    /**
     * Skip the testcase fetch. Useful for pipelines that only need scores.
     * Defaults to false.
     */
    skipTestcases?: boolean
    /**
     * Optional callback invoked once per chunk with the raw per-stage timings
     * and counts. Lets the PoC / observability surface measure the hydrate
     * cost without coupling the transform to logging.
     */
    onChunkHydrated?: (info: {
        chunkScenarios: number
        resultsFetched: number
        metricsFetched: number
        testcasesFetched: number
        tracesFetched: number
        resultsMs: number
        metricsMs: number
        testcasesMs: number
        tracesMs: number
        totalMs: number
    }) => void
}

/**
 * Default fetchers — raw HTTP via the entities-package api layer.
 *
 * These do NOT consult the entity cache. They will refetch data even when
 * the same testcase / trace / metric is already in the TanStack cache from
 * another view. Acceptable for headless scripts and one-shot ETL runs;
 * upgrade to cache-aware fetchers in long-lived browser sessions.
 */
export const DEFAULT_HYDRATE_FETCHERS: HydrateFetchers = {
    fetchResults: queryEvaluationResults,
    fetchMetrics: queryEvaluationMetrics,
    fetchTestcases: ({projectId, testcaseIds}) => fetchTestcasesBatch({projectId, testcaseIds}),
    fetchTraces: async ({projectId, traceIds}) => {
        // Mirror what trace/state/store.ts:traceBatchFetcher does at the API
        // level: canonicalise IDs (strip dashes), bulk-fetch via IN filter,
        // rekey by the dashed form so the caller can look up by the value
        // they see in result.trace_id.
        const out = new Map<string, unknown>()
        if (traceIds.length === 0) return out
        const canonicalIds = traceIds.map((id) => id.replace(/-/g, ""))
        const data = await fetchAllPreviewTraces(
            {
                focus: "trace",
                format: "agenta",
                filter: JSON.stringify({
                    conditions: [{field: "trace_id", operator: "in", value: canonicalIds}],
                }),
            },
            "",
            projectId,
        )
        const tracesObj = (data as {traces?: Record<string, unknown>} | null)?.traces ?? {}
        traceIds.forEach((traceId, idx) => {
            const canon = canonicalIds[idx]
            if (tracesObj[canon] !== undefined) out.set(traceId, tracesObj[canon])
        })
        return out
    },
}

/**
 * Build a `Transform<TScenario, HydratedScenarioRow<TScenario>>` that joins
 * each chunk of scenarios with its correlated entities.
 *
 * Usage:
 * ```ts
 * const hydrate = makeHydrateScenariosTransform({projectId, runId})
 *
 * for await (const progress of runLoop(scenarioSource, [hydrate], hydratedSink, undefined)) {
 *   // ...
 * }
 * ```
 *
 * Per-chunk behaviour:
 *
 * 1. Collect scenario_ids and testcase_ids from the chunk.
 * 2. Fan out three parallel bulk calls — results, metrics, testcases.
 * 3. Once results return, collect trace_ids and fetch traces in one bulk call.
 * 4. Group results / metrics by scenario_id, look up testcase + traces, emit
 *    a hydrated row per scenario.
 */
export function makeHydrateScenariosTransform<TScenario extends HydratableScenario>(
    params: HydrateScenariosTransformParams,
): Transform<TScenario, HydratedScenarioRow<TScenario>> {
    const {
        projectId,
        runId,
        skipTraces = false,
        skipTestcases = false,
        onChunkHydrated,
        fetchers: fetcherOverrides,
    } = params
    const fetchers: HydrateFetchers = {
        ...DEFAULT_HYDRATE_FETCHERS,
        ...(fetcherOverrides ?? {}),
    }

    return async (chunk: Chunk<TScenario>): Promise<Chunk<HydratedScenarioRow<TScenario>>> => {
        const totalStart = performance.now()

        const scenarios = chunk.items
        const scenarioIds = scenarios.map((s) => s.id).filter(Boolean)

        // Empty chunk fast-path — nothing to hydrate, propagate cursor unchanged.
        if (scenarios.length === 0) {
            onChunkHydrated?.({
                chunkScenarios: 0,
                resultsFetched: 0,
                metricsFetched: 0,
                testcasesFetched: 0,
                tracesFetched: 0,
                resultsMs: 0,
                metricsMs: 0,
                testcasesMs: 0,
                tracesMs: 0,
                totalMs: 0,
            })
            return {
                items: [],
                cursor: chunk.cursor,
                meta: {...(chunk.meta as Record<string, unknown> | undefined), hydrated: true},
            }
        }

        // -----------------------------------------------------------------
        // Stage 1 — fan out results + metrics in parallel.
        //
        // We cannot fetch testcases yet because the run schema may carry
        // testcase_id on the input-step's *result*, not on the scenario.
        // We collect testcase_ids from both scenarios AND results in stage 2.
        // -----------------------------------------------------------------

        const resultsStart = performance.now()
        const metricsStart = performance.now()

        const [results, metrics] = await Promise.all([
            fetchers.fetchResults({projectId, runId, scenarioIds}).catch((e) => {
                console.warn(
                    `[hydrateScenarios] results fetch failed: ${e instanceof Error ? e.message : e}`,
                )
                return [] as EvaluationResult[]
            }),
            fetchers.fetchMetrics({projectId, runId, scenarioIds}).catch((e) => {
                console.warn(
                    `[hydrateScenarios] metrics fetch failed: ${e instanceof Error ? e.message : e}`,
                )
                return [] as EvaluationMetric[]
            }),
        ])

        const resultsMs = performance.now() - resultsStart
        const metricsMs = performance.now() - metricsStart

        // -----------------------------------------------------------------
        // Stage 2 — testcases + traces (both depend on results), in parallel.
        //   - testcase_ids come from scenario.testcase_id ∪ result.testcase_id
        //   - trace_ids   come from result.trace_id
        // -----------------------------------------------------------------

        const testcaseIds = Array.from(
            new Set(
                [
                    ...scenarios.map((s) => s.testcase_id),
                    ...results.map((r) => r.testcase_id),
                ].filter((v): v is string => typeof v === "string" && v.length > 0),
            ),
        )

        const testcasesStart = performance.now()
        const tracesStart = performance.now()
        let traceMap: Record<string, unknown> = {}
        let tracesFetched = 0
        let testcaseMap = new Map<string, Testcase>()

        const stage2Tasks: Promise<unknown>[] = []

        if (!skipTestcases && testcaseIds.length > 0) {
            stage2Tasks.push(
                fetchers
                    .fetchTestcases({projectId, testcaseIds})
                    .then((m) => {
                        testcaseMap = m
                    })
                    .catch((e) => {
                        console.warn(
                            `[hydrateScenarios] testcases fetch failed: ${e instanceof Error ? e.message : e}`,
                        )
                    }),
            )
        }

        if (!skipTraces) {
            const traceIds = Array.from(
                new Set(
                    results
                        .map((r) => r.trace_id)
                        .filter((v): v is string => typeof v === "string" && v.length > 0),
                ),
            )

            if (traceIds.length > 0) {
                stage2Tasks.push(
                    fetchers
                        .fetchTraces({projectId, traceIds})
                        .then((m) => {
                            m.forEach((trace, traceId) => {
                                traceMap[traceId] = trace
                                tracesFetched++
                            })
                        })
                        .catch((e) => {
                            console.warn(
                                `[hydrateScenarios] traces fetch failed: ${e instanceof Error ? e.message : e}`,
                            )
                        }),
                )
            }
        }

        await Promise.all(stage2Tasks)

        const testcasesMs = performance.now() - testcasesStart
        const tracesMs = performance.now() - tracesStart

        // -----------------------------------------------------------------
        // Stage 3 — group results/metrics by scenario, emit hydrated rows.
        // -----------------------------------------------------------------

        const resultsByScenario = new Map<string, EvaluationResult[]>()
        for (const r of results) {
            const arr = resultsByScenario.get(r.scenario_id) ?? []
            arr.push(r)
            resultsByScenario.set(r.scenario_id, arr)
        }

        const metricsByScenario = new Map<string, EvaluationMetric[]>()
        for (const m of metrics) {
            const sid = m.scenario_id ?? null
            if (!sid) continue // run-level aggregate; not joined to a row
            const arr = metricsByScenario.get(sid) ?? []
            arr.push(m)
            metricsByScenario.set(sid, arr)
        }

        const hydrated: HydratedScenarioRow<TScenario>[] = scenarios.map((scenario) => {
            const rowResults = resultsByScenario.get(scenario.id) ?? []
            const rowMetrics = metricsByScenario.get(scenario.id) ?? []

            // Testcase resolution — try scenario.testcase_id first, then fall
            // back to any result.testcase_id (input step results carry it when
            // the scenario itself doesn't). This handles both legacy and
            // current run-graph schemas.
            const scenarioTcId =
                typeof scenario.testcase_id === "string" ? scenario.testcase_id : null
            const resultTcId = rowResults
                .map((r) => r.testcase_id)
                .find((v): v is string => typeof v === "string" && v.length > 0)
            const effectiveTcId = scenarioTcId ?? resultTcId ?? null
            const testcase = effectiveTcId ? (testcaseMap.get(effectiveTcId) ?? null) : null

            // Only include traces this row actually references — keeps row payload
            // bounded; callers can still cross-reference by trace_id if needed.
            const rowTraces: Record<string, unknown> = {}
            for (const r of rowResults) {
                if (r.trace_id && traceMap[r.trace_id] !== undefined) {
                    rowTraces[r.trace_id] = traceMap[r.trace_id]
                }
            }

            return {
                scenario,
                results: rowResults,
                metrics: rowMetrics,
                testcase,
                traces: rowTraces,
            }
        })

        const totalMs = performance.now() - totalStart

        onChunkHydrated?.({
            chunkScenarios: scenarios.length,
            resultsFetched: results.length,
            metricsFetched: metrics.length,
            testcasesFetched: testcaseMap.size,
            tracesFetched,
            resultsMs,
            metricsMs,
            testcasesMs,
            tracesMs,
            totalMs,
        })

        return {
            items: hydrated,
            cursor: chunk.cursor,
            meta: {
                ...(chunk.meta as Record<string, unknown> | undefined),
                hydrated: true,
                hydrateCounts: {
                    scenarios: scenarios.length,
                    results: results.length,
                    metrics: metrics.length,
                    testcases: testcaseMap.size,
                    traces: tracesFetched,
                },
            },
        }
    }
}
