/**
 * Evaluator API Functions
 *
 * HTTP API functions for evaluator entities via the Workflows API.
 * These are pure functions with no Jotai dependencies.
 *
 * Evaluators follow the Workflow → Variant → Revision hierarchy:
 * - List: `POST /preview/workflows/query` (workflow-level, no data)
 * - Detail: `GET /preview/workflows/revisions/retrieve` (revision-level, has data)
 * - Create/Update: workflow + revision commit endpoints
 */

import {getAgentaApiUrl, axios} from "@agenta/shared/api"

import {safeParseWithLogging} from "../../shared"
import {
    evaluatorSchema,
    evaluatorResponseSchema,
    evaluatorsResponseSchema,
    evaluatorRevisionResponseSchema,
    evaluatorRevisionsResponseSchema,
    evaluatorVariantsResponseSchema,
    type Evaluator,
    type EvaluatorResponse,
    type EvaluatorsResponse,
    type EvaluatorVariantsResponse,
    type EvaluatorRevisionsResponse,
} from "../core"
import type {EvaluatorDetailParams, EvaluatorListParams} from "../core"

// ============================================================================
// QUERY / LIST (Workflows)
// ============================================================================

/**
 * Query evaluators with filters.
 *
 * Endpoint: `POST /preview/workflows/query`
 *
 * @param params - Query parameters
 * @returns Evaluators response with count and workflows array
 */
export async function queryEvaluators({
    projectId,
    includeArchived = false,
}: EvaluatorListParams): Promise<EvaluatorsResponse> {
    if (!projectId) {
        return {count: 0, workflows: []}
    }

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/workflows/query`,
        {
            workflow: {
                flags: {
                    is_evaluator: true,
                },
            },
            include_archived: includeArchived,
        },
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        evaluatorsResponseSchema,
        response.data,
        "[queryEvaluators]",
    )
    if (!validated) {
        return {count: 0, workflows: []}
    }
    return validated
}

// ============================================================================
// QUERY / LIST (Variants)
// ============================================================================

/**
 * Query workflow variants for a given evaluator (workflow).
 *
 * Endpoint: `POST /preview/workflows/variants/query`
 *
 * @param workflowId - The workflow (evaluator) ID
 * @param projectId - Project ID
 * @returns Variants response with workflow_variants array
 */
export async function queryEvaluatorVariants(
    workflowId: string,
    projectId: string,
): Promise<EvaluatorVariantsResponse> {
    if (!projectId || !workflowId) {
        return {count: 0, workflow_variants: []}
    }

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/workflows/variants/query`,
        {
            workflow_refs: [{id: workflowId}],
        },
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        evaluatorVariantsResponseSchema,
        response.data,
        "[queryEvaluatorVariants]",
    )
    if (!validated) {
        return {count: 0, workflow_variants: []}
    }
    return validated
}

// ============================================================================
// QUERY / LIST (Revisions)
// ============================================================================

/**
 * Query workflow revisions directly by workflow (evaluator) ID.
 * Skips the variant level — used for the 2-level selection hierarchy.
 *
 * Endpoint: `POST /preview/workflows/revisions/query`
 *
 * @param workflowId - The workflow (evaluator) ID
 * @param projectId - Project ID
 * @returns Revisions response with workflow_revisions array
 */
export async function queryEvaluatorRevisionsByWorkflow(
    workflowId: string,
    projectId: string,
): Promise<EvaluatorRevisionsResponse> {
    if (!projectId || !workflowId) {
        return {count: 0, workflow_revisions: []}
    }

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/workflows/revisions/query`,
        {
            workflow_refs: [{id: workflowId}],
        },
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        evaluatorRevisionsResponseSchema,
        response.data,
        "[queryEvaluatorRevisionsByWorkflow]",
    )
    if (!validated) {
        return {count: 0, workflow_revisions: []}
    }
    return validated
}

/**
 * Query workflow revisions for a given variant.
 *
 * Endpoint: `POST /preview/workflows/revisions/query`
 *
 * @param variantId - The workflow variant ID
 * @param projectId - Project ID
 * @returns Revisions response with workflow_revisions array
 */
export async function queryEvaluatorRevisions(
    variantId: string,
    projectId: string,
): Promise<EvaluatorRevisionsResponse> {
    if (!projectId || !variantId) {
        return {count: 0, workflow_revisions: []}
    }

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/workflows/revisions/query`,
        {
            workflow_variant_refs: [{id: variantId}],
        },
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        evaluatorRevisionsResponseSchema,
        response.data,
        "[queryEvaluatorRevisions]",
    )
    if (!validated) {
        return {count: 0, workflow_revisions: []}
    }
    return validated
}

// ============================================================================
// FETCH (Single Revision by Revision ID)
// ============================================================================

/**
 * Fetch a single workflow revision by its revision ID.
 *
 * Endpoint: `GET /preview/workflows/revisions/{revision_id}`
 *
 * @param revisionId - The workflow revision ID
 * @param projectId - Project ID
 * @returns The evaluator revision with data (uri, schemas, parameters, etc.)
 */
export async function fetchEvaluatorRevisionById(
    revisionId: string,
    projectId: string,
): Promise<Evaluator> {
    const response = await axios.get(
        `${getAgentaApiUrl()}/preview/workflows/revisions/${revisionId}`,
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        evaluatorRevisionResponseSchema,
        response.data,
        "[fetchEvaluatorRevisionById]",
    )
    if (!validated?.workflow_revision) {
        throw new Error(
            `[fetchEvaluatorRevisionById] Invalid response for revision_id=${revisionId}`,
        )
    }
    return validated.workflow_revision
}

// ============================================================================
// INSPECT (Resolve full schema including inputs)
// ============================================================================

/**
 * Response shape from the inspect endpoint.
 * Returns a WorkflowServiceRequest with resolved interface.
 */
export interface InspectWorkflowResponse {
    version?: string
    interface?: {
        version?: string
        uri?: string
        url?: string
        headers?: Record<string, unknown>
        schemas?: {
            parameters?: Record<string, unknown>
            inputs?: Record<string, unknown>
            outputs?: Record<string, unknown>
        }
    }
    configuration?: {
        script?: Record<string, unknown>
        parameters?: Record<string, unknown>
    }
}

/**
 * Inspect a workflow to resolve the full interface schema (including inputs).
 *
 * Revision data from the query endpoint often lacks `schemas.inputs`.
 * The inspect endpoint resolves the full schema from the handler registered
 * for the given URI.
 *
 * Endpoint: `POST /preview/workflows/inspect`
 *
 * @param uri - The workflow URI (e.g., "agenta:builtin:auto_ai_critique:v0")
 * @param projectId - Project ID
 * @returns Resolved interface with full schemas
 */
export async function inspectWorkflow(
    uri: string,
    projectId: string,
): Promise<InspectWorkflowResponse> {
    if (!projectId || !uri) {
        return {}
    }

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/workflows/inspect`,
        {
            interface: {uri},
        },
        {params: {project_id: projectId}},
    )

    return response.data ?? {}
}

// ============================================================================
// FETCH (Latest Revision by Workflow ID)
// ============================================================================

/**
 * Fetch a single evaluator's latest revision by workflow ID.
 *
 * Uses the revisions query endpoint to get the latest revision which
 * contains `data` (uri, schemas, parameters, etc.).
 *
 * Endpoint: `POST /preview/workflows/revisions/query`
 *
 * @param params - Detail parameters (id = workflow ID, projectId)
 * @returns The evaluator entity with revision data
 */
export async function fetchEvaluator({id, projectId}: EvaluatorDetailParams): Promise<Evaluator> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/workflows/revisions/query`,
        {
            workflow_refs: [{id}],
        },
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        evaluatorRevisionsResponseSchema,
        response.data,
        "[fetchEvaluator]",
    )
    const revision = validated?.workflow_revisions?.[0]
    if (!revision) {
        throw new Error(`[fetchEvaluator] No revision found for workflow_id=${id}`)
    }
    return revision
}

// ============================================================================
// CREATE
// ============================================================================

/**
 * Request body for creating an evaluator.
 *
 * Maps to backend `WorkflowCreateRequest` + `WorkflowRevisionCommitRequest`.
 * The workflow is created first, then a revision is committed with the data.
 */
export interface CreateEvaluatorPayload {
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
 * Create a new evaluator workflow and commit its initial revision.
 *
 * Endpoints:
 * - `POST /preview/workflows/` (create workflow)
 * - `POST /preview/workflows/revisions/commit` (commit revision with data)
 *
 * @param projectId - Project ID
 * @param payload - Evaluator creation data
 * @returns The created evaluator (revision with data)
 */
export async function createEvaluator(
    projectId: string,
    payload: CreateEvaluatorPayload,
): Promise<Evaluator> {
    // Step 1: Create the workflow
    const workflowResponse = await axios.post(
        `${getAgentaApiUrl()}/preview/workflows/`,
        {
            workflow: {
                slug: payload.slug,
                name: payload.name,
                description: payload.description,
                flags: {
                    is_evaluator: true,
                    ...payload.flags,
                },
                tags: payload.tags,
                meta: payload.meta,
            },
        },
        {params: {project_id: projectId}},
    )

    const validatedWorkflow = safeParseWithLogging(
        evaluatorResponseSchema,
        workflowResponse.data,
        "[createEvaluator:workflow]",
    )
    if (!validatedWorkflow?.workflow) {
        throw new Error("[createEvaluator] Failed to create workflow")
    }

    const workflowId = validatedWorkflow.workflow.id

    // Step 2: Commit the initial revision with data
    if (payload.data) {
        const commitResponse = await axios.post(
            `${getAgentaApiUrl()}/preview/workflows/revisions/commit`,
            {
                workflow_revision: {
                    workflow_id: workflowId,
                    flags: {
                        is_evaluator: true,
                        ...payload.flags,
                    },
                    data: payload.data,
                },
            },
            {params: {project_id: projectId}},
        )

        const validatedRevision = safeParseWithLogging(
            evaluatorRevisionResponseSchema,
            commitResponse.data,
            "[createEvaluator:revision]",
        )
        if (validatedRevision?.workflow_revision) {
            return validatedRevision.workflow_revision
        }
    }

    // Return workflow if no data to commit
    return validatedWorkflow.workflow
}

// ============================================================================
// UPDATE
// ============================================================================

/**
 * Request body for updating an evaluator.
 *
 * Updates workflow metadata and/or commits a new revision with updated data.
 */
export interface UpdateEvaluatorPayload {
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
 * If `data` is provided, commits a new revision.
 * Otherwise, updates workflow metadata only.
 *
 * @param projectId - Project ID
 * @param payload - Evaluator update data (must include `id` = workflow ID)
 * @returns The updated evaluator (revision with data)
 */
export async function updateEvaluator(
    projectId: string,
    payload: UpdateEvaluatorPayload,
): Promise<Evaluator> {
    // Update workflow metadata if non-data fields changed
    const hasMetadataChanges = payload.name || payload.description || payload.flags || payload.tags
    if (hasMetadataChanges) {
        await axios.put(
            `${getAgentaApiUrl()}/preview/workflows/${payload.id}`,
            {
                workflow: {
                    id: payload.id,
                    name: payload.name,
                    description: payload.description,
                    flags: {
                        is_evaluator: true,
                        ...payload.flags,
                    },
                    tags: payload.tags,
                    meta: payload.meta,
                },
            },
            {params: {project_id: projectId}},
        )
    }

    // Commit a new revision if data changed
    if (payload.data) {
        const commitResponse = await axios.post(
            `${getAgentaApiUrl()}/preview/workflows/revisions/commit`,
            {
                workflow_revision: {
                    workflow_id: payload.id,
                    flags: {
                        is_evaluator: true,
                        ...payload.flags,
                    },
                    data: payload.data,
                },
            },
            {params: {project_id: projectId}},
        )

        const validatedRevision = safeParseWithLogging(
            evaluatorRevisionResponseSchema,
            commitResponse.data,
            "[updateEvaluator:revision]",
        )
        if (validatedRevision?.workflow_revision) {
            return validatedRevision.workflow_revision
        }
    }

    // Fall back to fetching the latest revision
    return fetchEvaluator({id: payload.id, projectId})
}

// ============================================================================
// ARCHIVE (Soft Delete)
// ============================================================================

/**
 * Archive (soft delete) an evaluator.
 *
 * Endpoint: `POST /preview/workflows/{id}/archive`
 *
 * @param projectId - Project ID
 * @param evaluatorId - Evaluator ID to archive
 * @returns The archived evaluator response
 */
export async function archiveEvaluator(
    projectId: string,
    evaluatorId: string,
): Promise<EvaluatorResponse> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/workflows/${evaluatorId}/archive`,
        {},
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        evaluatorResponseSchema,
        response.data,
        "[archiveEvaluator]",
    )
    return validated ?? {count: 0, workflow: null}
}

// ============================================================================
// UNARCHIVE
// ============================================================================

/**
 * Unarchive (restore) an evaluator.
 *
 * Endpoint: `POST /preview/workflows/{id}/unarchive`
 *
 * @param projectId - Project ID
 * @param evaluatorId - Evaluator ID to unarchive
 * @returns The restored evaluator response
 */
export async function unarchiveEvaluator(
    projectId: string,
    evaluatorId: string,
): Promise<EvaluatorResponse> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/workflows/${evaluatorId}/unarchive`,
        {},
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        evaluatorResponseSchema,
        response.data,
        "[unarchiveEvaluator]",
    )
    return validated ?? {count: 0, workflow: null}
}

// ============================================================================
// TEMPLATES
// ============================================================================

/**
 * Template entry from the evaluator templates endpoint.
 */
export interface EvaluatorTemplate {
    key: string
    name: string
    [k: string]: unknown
}

interface EvaluatorTemplatesResponse {
    count: number
    templates: EvaluatorTemplate[]
}

/**
 * Fetch evaluator template definitions.
 *
 * Endpoint: `GET /preview/simple/evaluators/templates`
 *
 * @param projectId - Project ID
 * @returns Array of evaluator templates with key and name
 */
export async function fetchEvaluatorTemplates(projectId: string): Promise<EvaluatorTemplate[]> {
    if (!projectId) return []

    const response = await axios.get<EvaluatorTemplatesResponse>(
        `${getAgentaApiUrl()}/preview/simple/evaluators/templates`,
        {params: {project_id: projectId}},
    )

    return response.data?.templates ?? []
}

// ============================================================================
// BATCH FETCH
// ============================================================================

/**
 * Batch fetch evaluator revisions by revision IDs.
 *
 * Uses the revision query endpoint with workflow_revision_refs to fetch
 * multiple revisions in a single HTTP call.
 *
 * Endpoint: `POST /preview/workflows/revisions/query`
 *
 * @param projectId - Project ID
 * @param revisionIds - Array of revision IDs to fetch
 * @returns Map of revision ID → Evaluator
 */
export async function fetchEvaluatorRevisionsByIdsBatch(
    projectId: string,
    revisionIds: string[],
): Promise<Map<string, Evaluator>> {
    const results = new Map<string, Evaluator>()

    if (!projectId || revisionIds.length === 0) return results

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/workflows/revisions/query`,
        {
            workflow_revision_refs: revisionIds.map((id) => ({id})),
        },
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        evaluatorRevisionsResponseSchema,
        response.data,
        "[fetchEvaluatorRevisionsByIdsBatch]",
    )
    if (!validated) return results

    for (const raw of validated.workflow_revisions) {
        try {
            const evaluator = safeParseWithLogging(
                evaluatorSchema,
                raw,
                "[fetchEvaluatorRevisionsByIdsBatch:item]",
            )
            if (evaluator) {
                results.set(evaluator.id, evaluator)
            }
        } catch (e) {
            console.error("[fetchEvaluatorRevisionsByIdsBatch] Failed to parse evaluator:", e, raw)
        }
    }

    return results
}

/**
 * Batch fetch evaluator revisions by workflow IDs.
 *
 * Uses the revision query endpoint with workflow_refs to fetch latest revisions.
 *
 * Endpoint: `POST /preview/workflows/revisions/query`
 *
 * @param projectId - Project ID
 * @param evaluatorIds - Array of workflow IDs to fetch revisions for
 * @returns Map of workflow ID → Evaluator (revision with data)
 */
export async function fetchEvaluatorsBatch(
    projectId: string,
    evaluatorIds: string[],
): Promise<Map<string, Evaluator>> {
    const results = new Map<string, Evaluator>()

    if (!projectId || evaluatorIds.length === 0) return results

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/workflows/revisions/query`,
        {
            workflow_refs: evaluatorIds.map((id) => ({id})),
        },
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        evaluatorRevisionsResponseSchema,
        response.data,
        "[fetchEvaluatorsBatch]",
    )
    if (!validated) return results

    for (const raw of validated.workflow_revisions) {
        try {
            const evaluator = safeParseWithLogging(
                evaluatorSchema,
                raw,
                "[fetchEvaluatorsBatch:item]",
            )
            if (evaluator) {
                // Key by workflow_id so callers can look up by the workflow ID they passed in
                const key = evaluator.workflow_id ?? evaluator.id
                results.set(key, evaluator)
            }
        } catch (e) {
            console.error("[fetchEvaluatorsBatch] Failed to parse evaluator:", e, raw)
        }
    }

    return results
}
