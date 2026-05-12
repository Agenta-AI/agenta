/**
 * SimpleQueue API Functions
 *
 * HTTP API functions for SimpleQueue entities.
 * These are pure functions with no Jotai dependencies.
 *
 * Base endpoint: `/simple/queues/`
 */

import {getAgentaApiUrl, axios} from "@agenta/shared/api"

import {deleteEvaluationQueue, deleteEvaluationQueues} from "../../evaluationQueue/api"
import {safeParseWithLogging} from "../../shared"
import {
    simpleQueueResponseSchema,
    simpleQueuesResponseSchema,
    simpleQueueIdResponseSchema,
    simpleQueueIdsResponseSchema,
    simpleQueueScenariosResponseSchema,
    type SimpleQueue,
    type SimpleQueuesResponse,
    type SimpleQueueIdResponse,
    type SimpleQueueIdsResponse,
    type SimpleQueueScenariosResponse,
    type SimpleQueueKind,
} from "../core"
import type {
    SimpleQueueListParams,
    SimpleQueueDetailParams,
    SimpleQueueScenariosParams,
} from "../core"

// ============================================================================
// CREATE
// ============================================================================

/**
 * Payload for creating a simple queue.
 * Matches backend `SimpleQueueCreateRequest`.
 */
export interface CreateSimpleQueuePayload {
    name?: string | null
    description?: string | null
    data?: {
        kind: SimpleQueueKind
        evaluators?: unknown
        repeats?: number | null
        assignments?: string[][] | null
        settings?: {
            batch_size?: number | null
            batch_offset?: number | null
        } | null
    } | null
    tags?: string[] | null
    meta?: Record<string, unknown> | null
}

/**
 * Create a new simple queue.
 *
 * Endpoint: `POST /simple/queues/`
 */
export async function createSimpleQueue(
    projectId: string,
    payload: CreateSimpleQueuePayload,
): Promise<SimpleQueue | null> {
    if (!projectId) return null

    const response = await axios.post(
        `${getAgentaApiUrl()}/simple/queues/`,
        {queue: payload},
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        simpleQueueResponseSchema,
        response.data,
        "[createSimpleQueue]",
    )
    return validated?.queue ?? null
}

// ============================================================================
// QUERY / LIST
// ============================================================================

/**
 * Query simple queues with filters and cursor-based pagination.
 *
 * Endpoint: `POST /simple/queues/query`
 */
export async function querySimpleQueues({
    projectId,
    kind,
    userId,
    name,
    windowing,
}: SimpleQueueListParams): Promise<SimpleQueuesResponse> {
    if (!projectId) {
        return {count: 0, queues: []}
    }

    const queueFilter: Record<string, unknown> = {}
    if (kind) queueFilter.kind = kind
    if (userId) queueFilter.user_id = userId
    if (name) queueFilter.name = name

    const response = await axios.post(
        `${getAgentaApiUrl()}/simple/queues/query`,
        {
            queue: Object.keys(queueFilter).length > 0 ? queueFilter : undefined,
            windowing: windowing ?? undefined,
        },
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        simpleQueuesResponseSchema,
        response.data,
        "[querySimpleQueues]",
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
 * Fetch a single simple queue by ID.
 *
 * Endpoint: `GET /simple/queues/{queue_id}`
 */
export async function fetchSimpleQueue({
    id,
    projectId,
}: SimpleQueueDetailParams): Promise<SimpleQueue | null> {
    if (!projectId || !id) return null

    const response = await axios.get(`${getAgentaApiUrl()}/simple/queues/${id}`, {
        params: {project_id: projectId},
    })

    const validated = safeParseWithLogging(
        simpleQueueResponseSchema,
        response.data,
        "[fetchSimpleQueue]",
    )
    return validated?.queue ?? null
}

// ============================================================================
// DELETE
// ============================================================================

/**
 * Delete a simple queue by ID.
 *
 * Uses the existing evaluation queue delete endpoint because simple queues are
 * backed by evaluation queues.
 */
export async function deleteSimpleQueue(
    projectId: string,
    queueId: string,
): Promise<SimpleQueueIdResponse> {
    if (!projectId || !queueId) {
        return {count: 0, queue_id: null}
    }

    const response = await deleteEvaluationQueue({id: queueId, projectId})

    const validated = safeParseWithLogging(
        simpleQueueIdResponseSchema,
        response,
        "[deleteSimpleQueue]",
    )
    return validated ?? {count: 0, queue_id: null}
}

/**
 * Delete multiple simple queues by ID.
 *
 * Uses the existing evaluation queue bulk delete endpoint because simple
 * queues are backed by evaluation queues.
 */
export async function deleteSimpleQueues(
    projectId: string,
    queueIds: string[],
): Promise<SimpleQueueIdsResponse> {
    const normalizedQueueIds = Array.from(new Set(queueIds.filter(Boolean)))
    if (!projectId || normalizedQueueIds.length === 0) {
        return {count: 0, queue_ids: []}
    }

    const response = await deleteEvaluationQueues(projectId, normalizedQueueIds)

    const validated = safeParseWithLogging(
        simpleQueueIdsResponseSchema,
        response,
        "[deleteSimpleQueues]",
    )
    return validated ?? {count: 0, queue_ids: []}
}

// ============================================================================
// SCENARIOS
// ============================================================================

/**
 * Query scenarios for a simple queue.
 *
 * Endpoint: `POST /simple/queues/{queue_id}/scenarios/query`
 */
export async function querySimpleQueueScenarios({
    queueId,
    projectId,
    userId,
    scenario,
    windowing,
}: SimpleQueueScenariosParams): Promise<SimpleQueueScenariosResponse> {
    if (!projectId || !queueId) {
        return {count: 0, scenarios: [], windowing: null}
    }

    const body: Record<string, unknown> = {}
    if (userId) body.queue = {user_id: userId}
    if (scenario) body.scenario = scenario
    if (windowing) body.windowing = windowing

    const response = await axios.post(
        `${getAgentaApiUrl()}/simple/queues/${queueId}/scenarios/query`,
        body,
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        simpleQueueScenariosResponseSchema,
        response.data,
        "[querySimpleQueueScenarios]",
    )
    if (!validated) {
        return {count: 0, scenarios: [], windowing: null}
    }
    return validated
}

// ============================================================================
// ADD ITEMS
// ============================================================================

/**
 * Add trace IDs to a simple queue.
 *
 * Endpoint: `POST /simple/queues/{queue_id}/traces/`
 */
export async function addSimpleQueueTraces(
    projectId: string,
    queueId: string,
    traceIds: string[],
): Promise<SimpleQueueIdResponse> {
    if (!projectId || !queueId || traceIds.length === 0) {
        return {count: 0, queue_id: null}
    }

    const response = await axios.post(
        `${getAgentaApiUrl()}/simple/queues/${queueId}/traces/`,
        {trace_ids: traceIds},
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        simpleQueueIdResponseSchema,
        response.data,
        "[addSimpleQueueTraces]",
    )
    return validated ?? {count: 0, queue_id: null}
}

/**
 * Add testcase IDs to a simple queue.
 *
 * Endpoint: `POST /simple/queues/{queue_id}/testcases/`
 */
export async function addSimpleQueueTestcases(
    projectId: string,
    queueId: string,
    testcaseIds: string[],
): Promise<SimpleQueueIdResponse> {
    if (!projectId || !queueId || testcaseIds.length === 0) {
        return {count: 0, queue_id: null}
    }

    const response = await axios.post(
        `${getAgentaApiUrl()}/simple/queues/${queueId}/testcases/`,
        {testcase_ids: testcaseIds},
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        simpleQueueIdResponseSchema,
        response.data,
        "[addSimpleQueueTestcases]",
    )
    return validated ?? {count: 0, queue_id: null}
}
