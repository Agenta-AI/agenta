/**
 * EvaluationRun API Functions
 *
 * HTTP API functions for EvaluationRun entities.
 * These are pure functions with no Jotai dependencies.
 *
 * Base endpoint: `/evaluations/runs/`
 */

import {getAgentaApiUrl, axios} from "@agenta/shared/api"

import {safeParseWithLogging} from "../../shared"
import {
    evaluationRunResponseSchema,
    evaluationRunsResponseSchema,
    evaluationResultsResponseSchema,
    type EvaluationRun,
    type EvaluationRunsResponse,
    type EvaluationResult,
} from "../core"
import type {
    EvaluationRunDetailParams,
    EvaluationRunQueryParams,
    EvaluationResultsQueryParams,
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
