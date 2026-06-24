/**
 * EvaluationQueue API Functions
 *
 * HTTP API functions for EvaluationQueue entities, backed by the Fern-generated
 * `@agentaai/api-client` via `@agenta/sdk`. Pure functions, no Jotai dependencies.
 *
 * Base endpoint: `/evaluations/queues/`.
 *
 * Zod validation stays at the boundary: Fern's generated types are all-optional /
 * nullable, so the local schemas narrow them and act as an independent drift check.
 */

import {getEvaluationsClient, projectScopedRequest} from "../../evaluationRun/api/client"
import {safeParseWithLogging} from "../../shared"
import {
    evaluationQueueResponseSchema,
    evaluationQueuesResponseSchema,
    evaluationQueueIdResponseSchema,
    type EvaluationQueue,
    type EvaluationQueuesResponse,
    type EvaluationQueueIdResponse,
} from "../core"
import type {EvaluationQueueListParams, EvaluationQueueDetailParams} from "../core"

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

    const queueFilter: {run_id?: string; user_id?: string} = {}
    if (runId) queueFilter.run_id = runId
    if (userId) queueFilter.user_id = userId

    const client = await getEvaluationsClient()
    const data = await client.queryQueues(
        Object.keys(queueFilter).length > 0 ? {queue: queueFilter} : {},
        projectScopedRequest(projectId),
    )

    const validated = safeParseWithLogging(
        evaluationQueuesResponseSchema,
        data,
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

    const client = await getEvaluationsClient()
    const data = await client.fetchQueue({queue_id: id}, projectScopedRequest(projectId))

    const validated = safeParseWithLogging(
        evaluationQueueResponseSchema,
        data,
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

    const client = await getEvaluationsClient()
    const data = await client.deleteQueue({queue_id: id}, projectScopedRequest(projectId))

    const validated = safeParseWithLogging(
        evaluationQueueIdResponseSchema,
        data,
        "[deleteEvaluationQueue]",
    )
    return validated ?? {count: 0, queue_id: null}
}
