/**
 * EvaluationQueue API Functions
 *
 * HTTP API functions for EvaluationQueue entities.
 * These are pure functions with no Jotai dependencies.
 *
 * Base endpoint: `/evaluations/queues/`
 */

import {getAgentaApiUrl, axios} from "@agenta/shared/api"

import {safeParseWithLogging} from "../../shared"
import {
    evaluationQueueResponseSchema,
    evaluationQueuesResponseSchema,
    evaluationQueueIdResponseSchema,
    evaluationQueueIdsResponseSchema,
    evaluationQueueScenarioIdsResponseSchema,
    type EvaluationQueue,
    type EvaluationQueuesResponse,
    type EvaluationQueueIdResponse,
    type EvaluationQueueIdsResponse,
    type EvaluationQueueScenarioIdsResponse,
} from "../core"
import type {
    EvaluationQueueListParams,
    EvaluationQueueDetailParams,
    EvaluationQueueScenariosParams,
} from "../core"

// ============================================================================
// QUERY / LIST
// ============================================================================

/**
 * Query evaluation queues with filters.
 *
 * Endpoint: `POST /evaluations/queues/query`
 */
export async function queryEvaluationQueues({
    projectId,
    runId,
    userId,
}: EvaluationQueueListParams): Promise<EvaluationQueuesResponse> {
    if (!projectId) {
        return {count: 0, queues: []}
    }

    const queueFilter: Record<string, unknown> = {}
    if (runId) queueFilter.run_id = runId
    if (userId) queueFilter.user_id = userId

    const response = await axios.post(
        `${getAgentaApiUrl()}/evaluations/queues/query`,
        {
            queue: Object.keys(queueFilter).length > 0 ? queueFilter : undefined,
        },
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        evaluationQueuesResponseSchema,
        response.data,
        "[queryEvaluationQueues]",
    )
    if (!validated) {
        return {count: 0, queues: []}
    }
    return validated
}

// ============================================================================
// FETCH (Single)
// ============================================================================

/**
 * Fetch a single evaluation queue by ID.
 *
 * Endpoint: `GET /evaluations/queues/{queue_id}`
 */
export async function fetchEvaluationQueue({
    id,
    projectId,
}: EvaluationQueueDetailParams): Promise<EvaluationQueue | null> {
    if (!projectId || !id) return null

    const response = await axios.get(`${getAgentaApiUrl()}/evaluations/queues/${id}`, {
        params: {project_id: projectId},
    })

    const validated = safeParseWithLogging(
        evaluationQueueResponseSchema,
        response.data,
        "[fetchEvaluationQueue]",
    )
    return validated?.queue ?? null
}

// ============================================================================
// DELETE
// ============================================================================

/**
 * Delete a single evaluation queue by ID.
 *
 * Endpoint: `DELETE /evaluations/queues/{queue_id}`
 */
export async function deleteEvaluationQueue({
    id,
    projectId,
}: EvaluationQueueDetailParams): Promise<EvaluationQueueIdResponse> {
    if (!projectId || !id) {
        return {count: 0, queue_id: null}
    }

    const response = await axios.delete(`${getAgentaApiUrl()}/evaluations/queues/${id}`, {
        params: {project_id: projectId},
    })

    const validated = safeParseWithLogging(
        evaluationQueueIdResponseSchema,
        response.data,
        "[deleteEvaluationQueue]",
    )
    return validated ?? {count: 0, queue_id: null}
}

/**
 * Delete multiple evaluation queues by ID.
 *
 * Endpoint: `DELETE /evaluations/queues/`
 */
export async function deleteEvaluationQueues(
    projectId: string,
    queueIds: string[],
): Promise<EvaluationQueueIdsResponse> {
    const normalizedQueueIds = Array.from(new Set(queueIds.filter(Boolean)))
    if (!projectId || normalizedQueueIds.length === 0) {
        return {count: 0, queue_ids: []}
    }

    const response = await axios.delete(`${getAgentaApiUrl()}/evaluations/queues/`, {
        params: {project_id: projectId},
        data: {queue_ids: normalizedQueueIds},
    })

    const validated = safeParseWithLogging(
        evaluationQueueIdsResponseSchema,
        response.data,
        "[deleteEvaluationQueues]",
    )
    return validated ?? {count: 0, queue_ids: []}
}

// ============================================================================
// SCENARIOS
// ============================================================================

/**
 * Query scenarios for an evaluation queue.
 * Returns scenario_ids grouped by repeat.
 *
 * Endpoint: `POST /evaluations/queues/{queue_id}/scenarios/query`
 */
export async function queryEvaluationQueueScenarios({
    queueId,
    projectId,
    userId,
}: EvaluationQueueScenariosParams): Promise<EvaluationQueueScenarioIdsResponse> {
    if (!projectId || !queueId) {
        return {count: 0, scenario_ids: []}
    }

    const body: Record<string, unknown> = {}
    if (userId) {
        body.queue = {user_id: userId}
    }

    const response = await axios.post(
        `${getAgentaApiUrl()}/evaluations/queues/${queueId}/scenarios/query`,
        body,
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        evaluationQueueScenarioIdsResponseSchema,
        response.data,
        "[queryEvaluationQueueScenarios]",
    )
    if (!validated) {
        return {count: 0, scenario_ids: []}
    }
    return validated
}
