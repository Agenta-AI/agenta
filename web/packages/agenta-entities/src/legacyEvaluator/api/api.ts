/**
 * LegacyEvaluator API Functions
 *
 * HTTP API functions for SimpleEvaluator entities via the
 * `/preview/simple/evaluators/` facade endpoints.
 *
 * These endpoints flatten the Artifact → Variant → Revision hierarchy
 * into a single SimpleEvaluator entity.
 *
 * Endpoints:
 * - List:      POST /preview/simple/evaluators/query
 * - Fetch:     GET  /preview/simple/evaluators/{id}
 * - Create:    POST /preview/simple/evaluators/
 * - Update:    PUT  /preview/simple/evaluators/{id}
 * - Archive:   POST /preview/simple/evaluators/{id}/archive
 * - Unarchive: POST /preview/simple/evaluators/{id}/unarchive
 */

import {getAgentaApiUrl, axios} from "@agenta/shared/api"

import {safeParseWithLogging} from "../../shared"
import {
    legacyEvaluatorSchema,
    legacyEvaluatorResponseSchema,
    legacyEvaluatorsResponseSchema,
    type LegacyEvaluator,
    type LegacyEvaluatorResponse,
    type LegacyEvaluatorsResponse,
} from "../core"
import type {LegacyEvaluatorListParams, LegacyEvaluatorDetailParams} from "../core"

// ============================================================================
// QUERY / LIST
// ============================================================================

/**
 * Query evaluators with filters.
 *
 * Endpoint: `POST /preview/simple/evaluators/query`
 *
 * @param params - Query parameters
 * @returns Evaluators response with count and evaluators array
 */
export async function queryLegacyEvaluators({
    projectId,
    includeArchived = false,
}: LegacyEvaluatorListParams): Promise<LegacyEvaluatorsResponse> {
    if (!projectId) {
        return {count: 0, evaluators: []}
    }

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/simple/evaluators/query`,
        {
            evaluator: {
                flags: {
                    is_evaluator: true,
                },
            },
            include_archived: includeArchived,
        },
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        legacyEvaluatorsResponseSchema,
        response.data,
        "[queryLegacyEvaluators]",
    )
    if (!validated) {
        return {count: 0, evaluators: []}
    }
    return validated
}

// ============================================================================
// FETCH (Single)
// ============================================================================

/**
 * Fetch a single evaluator by ID.
 *
 * Endpoint: `GET /preview/simple/evaluators/{id}`
 *
 * @param params - Detail parameters (id, projectId)
 * @returns The SimpleEvaluator entity (assembled from artifact + latest revision)
 */
export async function fetchLegacyEvaluator({
    id,
    projectId,
}: LegacyEvaluatorDetailParams): Promise<LegacyEvaluator> {
    const response = await axios.get(`${getAgentaApiUrl()}/preview/simple/evaluators/${id}`, {
        params: {project_id: projectId},
    })

    const validated = safeParseWithLogging(
        legacyEvaluatorResponseSchema,
        response.data,
        "[fetchLegacyEvaluator]",
    )
    if (!validated?.evaluator) {
        throw new Error(`[fetchLegacyEvaluator] Invalid response for evaluator_id=${id}`)
    }
    return validated.evaluator
}

// ============================================================================
// CREATE
// ============================================================================

/**
 * Request body for creating an evaluator via the SimpleEvaluator API.
 *
 * Maps to backend `SimpleEvaluatorCreateRequest`.
 * The backend auto-creates: Artifact + Variant + initial Revisions.
 */
export interface CreateLegacyEvaluatorPayload {
    slug: string
    name: string
    description?: string | null
    flags?: {
        is_custom?: boolean
        is_evaluator?: boolean
        is_human?: boolean
        is_chat?: boolean
    }
    tags?: string[] | null
    meta?: Record<string, unknown> | null
    data?: {
        uri?: string | null
        url?: string | null
        headers?: Record<string, unknown> | null
        schemas?: {
            parameters?: Record<string, unknown> | null
            inputs?: Record<string, unknown> | null
            outputs?: Record<string, unknown> | null
        } | null
        script?: Record<string, unknown> | null
        parameters?: Record<string, unknown> | null
    } | null
}

/**
 * Create a new evaluator.
 *
 * Endpoint: `POST /preview/simple/evaluators/`
 *
 * @param projectId - Project ID
 * @param payload - Evaluator creation data
 * @returns The created SimpleEvaluator
 */
export async function createLegacyEvaluator(
    projectId: string,
    payload: CreateLegacyEvaluatorPayload,
): Promise<LegacyEvaluator> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/simple/evaluators/`,
        {
            evaluator: {
                slug: payload.slug,
                name: payload.name,
                description: payload.description,
                flags: {
                    is_evaluator: true,
                    ...payload.flags,
                },
                tags: payload.tags,
                meta: payload.meta,
                data: payload.data,
            },
        },
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        legacyEvaluatorResponseSchema,
        response.data,
        "[createLegacyEvaluator]",
    )
    if (!validated?.evaluator) {
        throw new Error("[createLegacyEvaluator] Failed to create evaluator")
    }
    return validated.evaluator
}

// ============================================================================
// UPDATE
// ============================================================================

/**
 * Request body for updating an evaluator via the SimpleEvaluator API.
 *
 * Maps to backend `SimpleEvaluatorEditRequest`.
 * If `data` is provided, the backend commits a new revision (immutable history).
 * The `data` field must include existing values (like `uri`) alongside updates.
 */
export interface UpdateLegacyEvaluatorPayload {
    id: string
    name?: string | null
    description?: string | null
    flags?: {
        is_custom?: boolean
        is_evaluator?: boolean
        is_human?: boolean
        is_chat?: boolean
    }
    tags?: string[] | null
    meta?: Record<string, unknown> | null
    data?: {
        uri?: string | null
        url?: string | null
        headers?: Record<string, unknown> | null
        schemas?: {
            parameters?: Record<string, unknown> | null
            inputs?: Record<string, unknown> | null
            outputs?: Record<string, unknown> | null
        } | null
        script?: Record<string, unknown> | null
        parameters?: Record<string, unknown> | null
    } | null
}

/**
 * Update an existing evaluator.
 *
 * Endpoint: `PUT /preview/simple/evaluators/{id}`
 *
 * @param projectId - Project ID
 * @param payload - Evaluator update data (must include `id`)
 * @returns The updated SimpleEvaluator
 */
export async function updateLegacyEvaluator(
    projectId: string,
    payload: UpdateLegacyEvaluatorPayload,
): Promise<LegacyEvaluator> {
    const response = await axios.put(
        `${getAgentaApiUrl()}/preview/simple/evaluators/${payload.id}`,
        {
            evaluator: {
                id: payload.id,
                name: payload.name,
                description: payload.description,
                flags: {
                    is_evaluator: true,
                    ...payload.flags,
                },
                tags: payload.tags,
                meta: payload.meta,
                data: payload.data,
            },
        },
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        legacyEvaluatorResponseSchema,
        response.data,
        "[updateLegacyEvaluator]",
    )
    if (!validated?.evaluator) {
        throw new Error("[updateLegacyEvaluator] Failed to update evaluator")
    }
    return validated.evaluator
}

// ============================================================================
// ARCHIVE (Soft Delete)
// ============================================================================

/**
 * Archive (soft delete) an evaluator.
 *
 * Endpoint: `POST /preview/simple/evaluators/{id}/archive`
 *
 * @param projectId - Project ID
 * @param evaluatorId - Evaluator ID to archive
 * @returns The archived evaluator response
 */
export async function archiveLegacyEvaluator(
    projectId: string,
    evaluatorId: string,
): Promise<LegacyEvaluatorResponse> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/simple/evaluators/${evaluatorId}/archive`,
        {},
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        legacyEvaluatorResponseSchema,
        response.data,
        "[archiveLegacyEvaluator]",
    )
    return validated ?? {count: 0, evaluator: null}
}

// ============================================================================
// UNARCHIVE
// ============================================================================

/**
 * Unarchive (restore) an evaluator.
 *
 * Endpoint: `POST /preview/simple/evaluators/{id}/unarchive`
 *
 * @param projectId - Project ID
 * @param evaluatorId - Evaluator ID to unarchive
 * @returns The restored evaluator response
 */
export async function unarchiveLegacyEvaluator(
    projectId: string,
    evaluatorId: string,
): Promise<LegacyEvaluatorResponse> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/simple/evaluators/${evaluatorId}/unarchive`,
        {},
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        legacyEvaluatorResponseSchema,
        response.data,
        "[unarchiveLegacyEvaluator]",
    )
    return validated ?? {count: 0, evaluator: null}
}

// ============================================================================
// BATCH FETCH
// ============================================================================

/**
 * Batch fetch evaluators by IDs.
 *
 * Uses the query endpoint with evaluator_refs to fetch multiple evaluators.
 *
 * Endpoint: `POST /preview/simple/evaluators/query`
 *
 * @param projectId - Project ID
 * @param evaluatorIds - Array of evaluator IDs to fetch
 * @returns Map of evaluator ID → LegacyEvaluator
 */
export async function fetchLegacyEvaluatorsBatch(
    projectId: string,
    evaluatorIds: string[],
): Promise<Map<string, LegacyEvaluator>> {
    const results = new Map<string, LegacyEvaluator>()

    if (!projectId || evaluatorIds.length === 0) return results

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/simple/evaluators/query`,
        {
            evaluator_refs: evaluatorIds.map((id) => ({id})),
        },
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        legacyEvaluatorsResponseSchema,
        response.data,
        "[fetchLegacyEvaluatorsBatch]",
    )
    if (!validated) return results

    for (const raw of validated.evaluators) {
        try {
            const evaluator = safeParseWithLogging(
                legacyEvaluatorSchema,
                raw,
                "[fetchLegacyEvaluatorsBatch:item]",
            )
            if (evaluator) {
                results.set(evaluator.id, evaluator)
            }
        } catch (e) {
            console.error("[fetchLegacyEvaluatorsBatch] Failed to parse evaluator:", e, raw)
        }
    }

    return results
}
