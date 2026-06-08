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
    evaluationResultsResponseSchema,
    evaluationMetricsResponseSchema,
    type EvaluationRun,
    type EvaluationRunsResponse,
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
