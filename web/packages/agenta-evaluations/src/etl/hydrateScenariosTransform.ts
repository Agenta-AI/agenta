/**
 * hydrateScenariosTransform — correlated-entity row shapes for eval scenarios.
 *
 * Scenarios as returned by `/evaluations/scenarios/query` are *references*:
 * they carry an id, a status, a run_id, and a testcase_id. To render anything
 * meaningful in the UI (input data, app outputs, evaluator scores, traces) we
 * have to join 4 additional entities (results, metrics, testcases, traces).
 *
 * This module declares the shared shapes for that join — the hydratable
 * scenario input, the fully-joined output row, and the pluggable fetcher
 * contract. They are consumed by the column resolver (`resolveMappings`) and
 * the cell-level materializer.
 *
 * @packageDocumentation
 */

import type {EvaluationResult, EvaluationMetric} from "@agenta/entities/evaluationRun"
import type {Testcase} from "@agenta/entities/testcase"

/**
 * Minimal scenario shape the hydrate row builds on. Consumers may pass any
 * object that carries an `id` and (optionally) a `testcase_id`.
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
