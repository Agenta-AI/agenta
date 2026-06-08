/**
 * EvaluationRun API Functions
 *
 * HTTP API functions for EvaluationRun entities, backed by the Fern-generated
 * `@agentaai/api-client` via `@agenta/sdk`. Pure functions, no Jotai dependencies.
 *
 * Base endpoint: `/evaluations/runs/` (+ `/results/`, `/metrics/`).
 *
 * Zod validation stays at the boundary: Fern's generated types are all-optional /
 * nullable, so the local schemas narrow them into the strict shape the molecules and
 * ETL depend on, and act as an independent drift check against the backend.
 */

// See testcase/api/api.ts for rationale — the shared barrel pulls in CSS deps.
import {safeParseWithLogging} from "../../shared/utils/zodSchema"
import {
    evaluationRunResponseSchema,
    evaluationRunsResponseSchema,
    evaluationScenariosResponseSchema,
    evaluationResultsResponseSchema,
    evaluationMetricsResponseSchema,
    type EvaluationRun,
    type EvaluationRunsResponse,
    type EvaluationScenario,
    type EvaluationResult,
    type EvaluationMetric,
} from "../core"
import type {
    EvaluationRunDetailParams,
    EvaluationRunQueryParams,
    EvaluationResultsQueryParams,
    EvaluationMetricsQueryParams,
} from "../core"

import {getEvaluationsClient, projectScopedRequest} from "./client"

// ============================================================================
// FETCH (Single)
// ============================================================================

/**
 * Fetch a single evaluation run by ID.
 *
 * Endpoint: `GET /evaluations/runs/{run_id}`
 */
export async function fetchEvaluationRun({
    id,
    projectId,
}: EvaluationRunDetailParams): Promise<EvaluationRun | null> {
    if (!projectId || !id) return null

    const client = await getEvaluationsClient()
    const data = await client.fetchRun({run_id: id}, projectScopedRequest(projectId))

    const validated = safeParseWithLogging(
        evaluationRunResponseSchema,
        data,
        "[fetchEvaluationRun]",
    )
    return validated?.run ?? null
}

// ============================================================================
// EDIT (PATCH a single run)
// ============================================================================

/**
 * Edit a single evaluation run (PATCH `/evaluations/runs/{run_id}`).
 *
 * `run` is the partial run body (snake_case, `extra="allow"` on the backend) — at minimum
 * an `id` plus the fields to change, e.g. `data.steps` for evaluator-revision write-back.
 * Returns the updated run, or null if the response fails validation.
 */
export async function editEvaluationRun({
    projectId,
    runId,
    run,
}: {
    projectId: string
    runId: string
    run: Record<string, unknown>
}): Promise<EvaluationRun | null> {
    if (!projectId || !runId) return null

    const client = await getEvaluationsClient()
    const data = await client.editRun(
        {run_id: runId, run: run as never},
        projectScopedRequest(projectId),
    )

    const validated = safeParseWithLogging(evaluationRunResponseSchema, data, "[editEvaluationRun]")
    return validated?.run ?? null
}

// ============================================================================
// QUERY (Batch by IDs)
// ============================================================================

/**
 * Query evaluation runs by a list of IDs.
 *
 * Endpoint: `POST /evaluations/runs/query`
 */
export async function queryEvaluationRuns({
    projectId,
    ids,
}: EvaluationRunQueryParams): Promise<EvaluationRunsResponse> {
    if (!projectId) return {count: 0, runs: []}
    if (ids && ids.length === 0) return {count: 0, runs: []}

    const client = await getEvaluationsClient()
    const data = await client.queryRuns(
        ids && ids.length > 0 ? {run: {ids}} : {},
        projectScopedRequest(projectId),
    )

    const validated = safeParseWithLogging(
        evaluationRunsResponseSchema,
        data,
        "[queryEvaluationRuns]",
    )
    return validated ?? {count: 0, runs: []}
}

// ============================================================================
// QUERY (List with filters + windowing)
// ============================================================================

export interface EvaluationRunsListParams {
    projectId: string
    appId?: string | null
    /** Reference filters (JSONB containment on the backend). */
    references?: Record<string, unknown>[] | null
    /** Flag filters (JSONB containment). Evaluation "kind" lives here, not as a field. */
    flags?: Record<string, unknown> | null
    /** Status filters. */
    statuses?: string[] | null
    /** Windowing/pagination passthrough (limit/order/next/...). */
    windowing?: Record<string, unknown> | null
}

export interface EvaluationRunsListResult {
    runs: EvaluationRun[]
    count: number
    windowing: Record<string, unknown> | null
}

/**
 * List evaluation runs with the filters the backend `query_runs` ACTUALLY supports:
 * references, flags (kind is encoded here), statuses, plus windowing. Endpoint:
 * `POST /evaluations/runs/query`.
 *
 * Note: `search` and `evaluation_kinds` are intentionally NOT sent — the backend query
 * has no such filters (they were silently dropped). Free-text/kind filtering is done
 * client-side (per the eval-filtering RFC).
 */
export async function queryEvaluationRunsList({
    projectId,
    appId,
    references,
    flags,
    statuses,
    windowing,
}: EvaluationRunsListParams): Promise<EvaluationRunsListResult> {
    if (!projectId) return {runs: [], count: 0, windowing: null}

    const runPayload: Record<string, unknown> = {}
    const refs = Array.isArray(references)
        ? references.filter((r) => r && Object.keys(r).length > 0)
        : []
    if (refs.length) runPayload.references = refs
    if (flags && Object.keys(flags).length > 0) runPayload.flags = flags
    if (statuses?.length) runPayload.statuses = statuses

    const body: Record<string, unknown> = {}
    if (Object.keys(runPayload).length > 0) body.run = runPayload
    if (windowing) body.windowing = windowing

    const queryParams: Record<string, string> = {project_id: projectId}
    if (appId) queryParams.app_id = appId

    const client = await getEvaluationsClient()
    const data = (await client.queryRuns(body as never, {queryParams})) as {
        windowing?: Record<string, unknown> | null
    }

    const validated = safeParseWithLogging(
        evaluationRunsResponseSchema,
        data,
        "[queryEvaluationRunsList]",
    )
    return {
        runs: validated?.runs ?? [],
        count: validated?.count ?? 0,
        // windowing is read off the raw response — the envelope schema doesn't model it.
        windowing: data?.windowing ?? null,
    }
}

// ============================================================================
// QUERY EVALUATION RESULTS (Scenario Steps)
// ============================================================================

/**
 * Query evaluation results (scenario steps) by run ID and scenario IDs.
 *
 * Each result represents one step's output for a scenario.
 * Results contain `trace_id` and `span_id` that link scenarios to traces.
 *
 * Endpoint: `POST /evaluations/results/query`
 */
export async function queryEvaluationResults({
    projectId,
    runId,
    scenarioIds,
    stepKeys,
}: EvaluationResultsQueryParams): Promise<EvaluationResult[]> {
    if (!projectId || !runId) return []
    if (scenarioIds && scenarioIds.length === 0) return []

    const client = await getEvaluationsClient()
    const data = await client.queryResults(
        {
            result: {
                run_id: runId,
                run_ids: [runId],
                ...(scenarioIds?.length ? {scenario_ids: scenarioIds} : {}),
                ...(stepKeys?.length ? {step_keys: stepKeys} : {}),
            },
            windowing: {},
        },
        projectScopedRequest(projectId),
    )

    const validated = safeParseWithLogging(
        evaluationResultsResponseSchema,
        data,
        "[queryEvaluationResults]",
    )
    return validated?.results ?? []
}

// ============================================================================
// SET EVALUATION RESULTS (upsert scenario steps)
// ============================================================================

/**
 * Fields the backend's `POST /evaluations/results/` (create_results, upsert on the natural
 * key run_id+scenario_id+step_key+repeat_idx) actually persists. Deliberately excludes
 * `span_id`/`references`/`data` — `evaluation_results` has no such columns; the result↔trace
 * link is carried by `trace_id`.
 */
export interface EvaluationResultSetInput {
    run_id: string
    scenario_id: string
    step_key: string
    status?: string
    trace_id?: string | null
    testcase_id?: string | null
    hash_id?: string | null
    repeat_idx?: number | null
    error?: Record<string, unknown> | null
}

/**
 * Upsert evaluation results (scenario steps). Endpoint: `POST /evaluations/results/`.
 *
 * The backend setter upserts on the natural key, so a single call covers create + edit.
 */
export async function setEvaluationResults({
    projectId,
    results,
}: {
    projectId: string
    results: EvaluationResultSetInput[]
}): Promise<EvaluationResult[]> {
    if (!projectId || !results.length) return []

    const client = await getEvaluationsClient()
    const data = await client.setResults(
        {results: results as never},
        projectScopedRequest(projectId),
    )

    const validated = safeParseWithLogging(
        evaluationResultsResponseSchema,
        data,
        "[setEvaluationResults]",
    )
    return validated?.results ?? []
}

// ============================================================================
// SCENARIOS (query + status edit)
// ============================================================================

/**
 * Query a run's scenarios. Endpoint: `POST /evaluations/scenarios/query`.
 */
export async function queryEvaluationScenarios({
    projectId,
    runId,
    limit = 1000,
}: {
    projectId: string
    runId: string
    limit?: number
}): Promise<EvaluationScenario[]> {
    if (!projectId || !runId) return []

    const client = await getEvaluationsClient()
    const data = await client.queryScenarios(
        {scenario: {run_ids: [runId]}, windowing: {limit}},
        projectScopedRequest(projectId),
    )

    const validated = safeParseWithLogging(
        evaluationScenariosResponseSchema,
        data,
        "[queryEvaluationScenarios]",
    )
    return validated?.scenarios ?? []
}

/**
 * Upsert scenario statuses. Endpoint: `PATCH /evaluations/scenarios/`.
 *
 * `EvaluationScenarioEdit` only carries id + status (+ flags/tags/meta), so this cannot
 * clobber scenario data.
 */
export async function setEvaluationScenarioStatuses({
    projectId,
    scenarios,
}: {
    projectId: string
    scenarios: {id: string; status: string}[]
}): Promise<EvaluationScenario[]> {
    if (!projectId || !scenarios.length) return []

    const client = await getEvaluationsClient()
    const data = await client.editScenarios(
        {scenarios: scenarios as never},
        projectScopedRequest(projectId),
    )

    const validated = safeParseWithLogging(
        evaluationScenariosResponseSchema,
        data,
        "[setEvaluationScenarioStatuses]",
    )
    return validated?.scenarios ?? []
}

// ============================================================================
// QUERY EVALUATION METRICS
// ============================================================================

/**
 * Query evaluation metrics by run ID and (optionally) scenario IDs.
 *
 * Metrics carry the actual scores / stat blobs. Per-scenario metrics have
 * `scenario_id` populated; run-level aggregates have `scenario_id = null`.
 *
 * Endpoint: `POST /evaluations/metrics/query`
 */
export async function queryEvaluationMetrics({
    projectId,
    runId,
    scenarioIds,
}: EvaluationMetricsQueryParams): Promise<EvaluationMetric[]> {
    if (!projectId || !runId) return []
    if (scenarioIds && scenarioIds.length === 0) return []

    const client = await getEvaluationsClient()
    const data = await client.queryMetrics(
        {
            metrics: {
                run_id: runId,
                ...(scenarioIds?.length ? {scenario_ids: scenarioIds} : {}),
            },
        },
        projectScopedRequest(projectId),
    )

    const validated = safeParseWithLogging(
        evaluationMetricsResponseSchema,
        data,
        "[queryEvaluationMetrics]",
    )
    return validated?.metrics ?? []
}
