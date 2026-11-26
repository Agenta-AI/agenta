/**
 * EvaluationRun API Functions
 *
 * HTTP API functions for EvaluationRun entities.
 * These are pure functions with no Jotai dependencies.
 *
 * Base endpoint: `/evaluations/runs/`
 */

import {getAgentaApiUrl, axios} from "@agenta/shared/api"

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

    const response = await axios.get(`${getAgentaApiUrl()}/evaluations/runs/${id}`, {
        params: {project_id: projectId},
    })

    const validated = safeParseWithLogging(
        evaluationRunResponseSchema,
        response.data,
        "[fetchEvaluationRun]",
    )
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

    const body: Record<string, unknown> = {}
    if (ids && ids.length > 0) {
        body.run = {ids}
    }

    const response = await axios.post(`${getAgentaApiUrl()}/evaluations/runs/query`, body, {
        params: {project_id: projectId},
    })

    const validated = safeParseWithLogging(
        evaluationRunsResponseSchema,
        response.data,
        "[queryEvaluationRuns]",
    )
    return validated ?? {count: 0, runs: []}
}

// ============================================================================
// FIND RUNS BY REFERENCE
// ============================================================================

/**
 * Ids of the evaluation runs that use any of the given references.
 *
 * Endpoint: `POST /evaluations/runs/query`, once per reference. The backend matches the
 * references of one query with JSONB containment (AND semantics), so a single query with many
 * references would only find runs that use all of them at once.
 */
export async function findEvaluationRunsUsing({
    projectId,
    references,
}: {
    projectId: string
    references: Record<string, {id: string}>[]
}): Promise<string[]> {
    if (!projectId || references.length === 0) return []

    const responses = await Promise.all(
        references.map((reference) =>
            axios.post(
                `${getAgentaApiUrl()}/evaluations/runs/query`,
                {run: {references: [reference]}},
                {params: {project_id: projectId}},
            ),
        ),
    )

    const runIds = new Set<string>()
    for (const response of responses) {
        for (const run of response.data?.runs ?? []) {
            if (run?.id) runIds.add(run.id)
        }
    }
    return [...runIds]
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

    const body: Record<string, unknown> = {
        result: {
            run_id: runId,
            run_ids: [runId],
            ...(scenarioIds?.length ? {scenario_ids: scenarioIds} : {}),
            ...(stepKeys?.length ? {step_keys: stepKeys} : {}),
        },
        windowing: {},
    }

    const response = await axios.post(`${getAgentaApiUrl()}/evaluations/results/query`, body, {
        params: {project_id: projectId},
    })

    const validated = safeParseWithLogging(
        evaluationResultsResponseSchema,
        response.data,
        "[queryEvaluationResults]",
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

    const body: Record<string, unknown> = {
        metrics: {
            run_id: runId,
            ...(scenarioIds?.length ? {scenario_ids: scenarioIds} : {}),
        },
    }

    const response = await axios.post(`${getAgentaApiUrl()}/evaluations/metrics/query`, body, {
        params: {project_id: projectId},
    })

    const validated = safeParseWithLogging(
        evaluationMetricsResponseSchema,
        response.data,
        "[queryEvaluationMetrics]",
    )
    return validated?.metrics ?? []
}
