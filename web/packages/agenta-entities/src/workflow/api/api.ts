/**
 * Workflow API Functions
 *
 * HTTP API functions for workflow entities via the Workflows API.
 * These are pure functions with no Jotai dependencies.
 *
 * Unlike evaluator API functions which hardcode `is_evaluator: true`,
 * workflow API functions accept optional flags and pass them through,
 * enabling consumers to filter by any combination of flags.
 *
 * Workflows follow the Workflow → Variant → Revision hierarchy:
 * - List: `POST /preview/workflows/query` (workflow-level, no data)
 * - Detail: `GET /preview/workflows/revisions/{id}` (revision-level, has data)
 * - Create/Update: workflow + revision commit endpoints
 */

import {getAgentaApiUrl, axios} from "@agenta/shared/api"
import {dereferenceSchema} from "@agenta/shared/utils"

import {extractAllEndpointSchemas, type OpenAPISpec} from "../../appRevision/api/schemaUtils"
import {parseRevisionUri, safeParseWithLogging} from "../../shared"
import {
    workflowSchema,
    workflowResponseSchema,
    workflowsResponseSchema,
    workflowRevisionResponseSchema,
    workflowRevisionsResponseSchema,
    workflowVariantsResponseSchema,
    type Workflow,
    type WorkflowResponse,
    type WorkflowsResponse,
    type WorkflowVariantsResponse,
    type WorkflowRevisionsResponse,
    type WorkflowFlags,
    type WorkflowQueryFlags,
} from "../core"
import type {WorkflowDetailParams, WorkflowListParams} from "../core"

const toUnixMs = (value: string | null | undefined): number => {
    if (!value) return 0
    const timestamp = new Date(value).getTime()
    return Number.isFinite(timestamp) ? timestamp : 0
}

const getWorkflowRecencyScore = (workflow: Workflow | null | undefined): number => {
    if (!workflow) return 0
    return (
        toUnixMs(workflow.created_at) ||
        toUnixMs(workflow.updated_at) ||
        Number(workflow.version ?? 0)
    )
}

const selectMostRecentWorkflowRevision = (
    workflows: (Workflow | null | undefined)[],
): Workflow | undefined => {
    let latest: Workflow | undefined
    let latestScore = -1

    for (const workflow of workflows) {
        if (!workflow) continue
        const score = getWorkflowRecencyScore(workflow)
        if (!latest || score > latestScore) {
            latest = workflow
            latestScore = score
        }
    }

    return latest
}

// ============================================================================
// QUERY / LIST (Workflows)
// ============================================================================

/**
 * Query workflows with optional flag filters.
 *
 * Endpoint: `POST /preview/workflows/query`
 *
 * @param params - Query parameters (flags is optional — omit for all workflows)
 * @returns Workflows response with count and workflows array
 */
export async function queryWorkflows({
    projectId,
    flags,
    includeArchived = false,
}: WorkflowListParams): Promise<WorkflowsResponse> {
    if (!projectId) {
        return {count: 0, workflows: []}
    }

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/workflows/query`,
        {
            workflow: flags ? {flags} : undefined,
            include_archived: includeArchived,
        },
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        workflowsResponseSchema,
        response.data,
        "[queryWorkflows]",
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
 * Query workflow variants for a given workflow.
 *
 * Endpoint: `POST /preview/workflows/variants/query`
 *
 * @param workflowId - The workflow ID
 * @param projectId - Project ID
 * @param flags - Optional query flags for filtering
 * @returns Variants response with workflow_variants array
 */
export async function queryWorkflowVariants(
    workflowId: string,
    projectId: string,
    flags?: WorkflowQueryFlags,
): Promise<WorkflowVariantsResponse> {
    if (!projectId || !workflowId) {
        return {count: 0, workflow_variants: []}
    }

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/workflows/variants/query`,
        {
            workflow_refs: [{id: workflowId}],
            workflow_variant: flags ? {flags} : undefined,
        },
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        workflowVariantsResponseSchema,
        response.data,
        "[queryWorkflowVariants]",
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
 * Query workflow revisions directly by workflow ID.
 * Skips the variant level — used for the 2-level selection hierarchy.
 *
 * Endpoint: `POST /preview/workflows/revisions/query`
 *
 * @param workflowId - The workflow ID
 * @param projectId - Project ID
 * @param flags - Optional query flags for filtering
 * @returns Revisions response with workflow_revisions array
 */
export async function queryWorkflowRevisionsByWorkflow(
    workflowId: string,
    projectId: string,
    flags?: WorkflowQueryFlags,
): Promise<WorkflowRevisionsResponse> {
    if (!projectId || !workflowId) {
        return {count: 0, workflow_revisions: []}
    }

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/workflows/revisions/query`,
        {
            workflow_refs: [{id: workflowId}],
            workflow_revision: flags ? {flags} : undefined,
        },
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        workflowRevisionsResponseSchema,
        response.data,
        "[queryWorkflowRevisionsByWorkflow]",
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
 * @param flags - Optional query flags for filtering
 * @returns Revisions response with workflow_revisions array
 */
export async function queryWorkflowRevisions(
    variantId: string,
    projectId: string,
    flags?: WorkflowQueryFlags,
): Promise<WorkflowRevisionsResponse> {
    if (!projectId || !variantId) {
        return {count: 0, workflow_revisions: []}
    }

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/workflows/revisions/query`,
        {
            workflow_variant_refs: [{id: variantId}],
            workflow_revision: flags ? {flags} : undefined,
        },
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        workflowRevisionsResponseSchema,
        response.data,
        "[queryWorkflowRevisions]",
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
 * @returns The workflow revision with data (uri, schemas, parameters, etc.)
 */
export async function fetchWorkflowRevisionById(
    revisionId: string,
    projectId: string,
): Promise<Workflow> {
    const response = await axios.get(
        `${getAgentaApiUrl()}/preview/workflows/revisions/${revisionId}`,
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        workflowRevisionResponseSchema,
        response.data,
        "[fetchWorkflowRevisionById]",
    )
    if (!validated?.workflow_revision) {
        throw new Error(
            `[fetchWorkflowRevisionById] Invalid response for revision_id=${revisionId}`,
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
 * @param uri - The workflow URI (e.g., "agenta:builtin:auto_exact_match:v0")
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
// INTERFACE SCHEMAS FETCH (for builtin workflows)
// ============================================================================

/**
 * Response shape from the interface schemas endpoint.
 * Returns schemas for a builtin workflow URI.
 */
export interface InterfaceSchemasResponse {
    uri?: string | null
    schemas?: {
        parameters?: Record<string, unknown> | null
        inputs?: Record<string, unknown> | null
        outputs?: Record<string, unknown> | null
    } | null
}

/**
 * Fetch interface schemas for a builtin workflow URI.
 *
 * This endpoint returns the parameters, inputs, and outputs schemas
 * for builtin workflow URIs (e.g., "agenta:builtin:auto_ai_critique:v0").
 *
 * This is useful as a fallback when revision data doesn't contain
 * the full schemas, allowing the frontend to dynamically render
 * configuration forms and validate inputs.
 *
 * Endpoint: `POST /preview/workflows/interfaces/schemas`
 *
 * @param uri - The workflow URI (e.g., "agenta:builtin:auto_exact_match:v0")
 * @param projectId - Project ID
 * @returns Interface schemas response with parameters, inputs, outputs
 */
export async function fetchInterfaceSchemas(
    uri: string,
    projectId: string,
): Promise<InterfaceSchemasResponse | null> {
    if (!projectId || !uri) {
        return null
    }

    try {
        const response = await axios.post(
            `${getAgentaApiUrl()}/preview/workflows/interfaces/schemas`,
            {uri},
            {params: {project_id: projectId}},
        )

        return response.data ?? null
    } catch (error) {
        console.error("[fetchInterfaceSchemas] Failed to fetch schemas", {uri, error})
        return null
    }
}

// ============================================================================
// OPENAPI SCHEMA FETCH (for app workflows that don't have schemas from inspect)
// ============================================================================

/**
 * Resolved schemas extracted from an app's OpenAPI spec.
 */
export interface AppOpenApiSchemas {
    inputs?: Record<string, unknown> | null
    outputs?: Record<string, unknown> | null
    parameters?: Record<string, unknown> | null
}

/**
 * Fetch and extract schemas from a workflow app's OpenAPI spec.
 *
 * For app workflows (non-evaluator), the inspect endpoint does not return
 * input schemas. This function uses the legacy OpenAPI approach:
 * 1. Parse the URL to get runtimePrefix and routePath
 * 2. Fetch `{url}/openapi.json`
 * 3. Dereference all $ref pointers
 * 4. Extract input/output/parameter schemas from endpoint definitions
 *
 * @param url - The app's service URL (from data.url)
 * @param projectId - Project ID
 * @returns Extracted schemas, or null on failure
 */
export async function fetchWorkflowAppOpenApiSchema(
    url: string,
    projectId: string,
): Promise<AppOpenApiSchemas | null> {
    if (!url || !projectId) return null

    try {
        const uriInfo = parseRevisionUri(url)
        if (!uriInfo) return null

        const {routePath} = uriInfo

        const openApiUrl = url.endsWith("/") ? `${url}openapi.json` : `${url}/openapi.json`
        const response = await axios.get<OpenAPISpec>(openApiUrl, {
            params: {project_id: projectId},
        })

        const rawSchema = response.data
        if (!rawSchema) return null

        const {schema: dereferencedSchema} = await dereferenceSchema(
            rawSchema as unknown as Record<string, unknown>,
        )
        if (!dereferencedSchema) return null

        const {primaryAgConfigSchema, primaryOutputsSchema, primaryEndpoint} =
            extractAllEndpointSchemas(dereferencedSchema as unknown as OpenAPISpec, routePath)

        return {
            inputs: (primaryEndpoint?.inputsSchema as Record<string, unknown> | null) ?? null,
            outputs: (primaryOutputsSchema as Record<string, unknown> | null) ?? null,
            parameters: (primaryAgConfigSchema as Record<string, unknown> | null) ?? null,
        }
    } catch (error) {
        console.error("[fetchWorkflowAppOpenApiSchema] Failed to fetch schema", {url, error})
        return null
    }
}

// ============================================================================
// FETCH (Latest Revision by Workflow ID)
// ============================================================================

/**
 * Fetch a single workflow's latest revision by workflow ID.
 *
 * Uses the revisions query endpoint to get the latest revision which
 * contains `data` (uri, schemas, parameters, etc.).
 *
 * Endpoint: `POST /preview/workflows/revisions/query`
 *
 * @param params - Detail parameters (id = workflow ID, projectId)
 * @returns The workflow entity with revision data
 */
export async function fetchWorkflow({id, projectId}: WorkflowDetailParams): Promise<Workflow> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/workflows/revisions/query`,
        {
            workflow_refs: [{id}],
            windowing: {limit: 1, order: "descending"},
        },
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        workflowRevisionsResponseSchema,
        response.data,
        "[fetchWorkflow]",
    )
    const revision = validated?.workflow_revisions?.[0]
    if (!revision) {
        throw new Error(`[fetchWorkflow] No revision found for workflow_id=${id}`)
    }
    return revision
}

// ============================================================================
// CREATE
// ============================================================================

/**
 * Request body for creating a workflow.
 *
 * Maps to backend `WorkflowCreateRequest` + `WorkflowRevisionCommitRequest`.
 * The workflow is created first, then a revision is committed with the data.
 */
export interface CreateWorkflowPayload {
    slug: string
    name: string
    description?: string | null
    flags?: WorkflowFlags
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
 * Create a new workflow and commit its initial revision.
 *
 * Endpoints:
 * - `POST /preview/workflows/` (create workflow)
 * - `POST /preview/workflows/revisions/commit` (commit revision with data)
 *
 * @param projectId - Project ID
 * @param payload - Workflow creation data (flags are passed through as-is)
 * @returns The created workflow (revision with data)
 */
export async function createWorkflow(
    projectId: string,
    payload: CreateWorkflowPayload,
): Promise<Workflow> {
    // Step 1: Create the workflow
    const workflowResponse = await axios.post(
        `${getAgentaApiUrl()}/preview/workflows/`,
        {
            workflow: {
                slug: payload.slug,
                name: payload.name,
                description: payload.description,
                flags: payload.flags,
                tags: payload.tags,
                meta: payload.meta,
            },
        },
        {params: {project_id: projectId}},
    )

    const validatedWorkflow = safeParseWithLogging(
        workflowResponseSchema,
        workflowResponse.data,
        "[createWorkflow:workflow]",
    )
    if (!validatedWorkflow?.workflow) {
        throw new Error("[createWorkflow] Failed to create workflow")
    }

    const workflowId = validatedWorkflow.workflow.id

    // Step 2: Commit the initial revision with data
    if (payload.data) {
        const commitResponse = await axios.post(
            `${getAgentaApiUrl()}/preview/workflows/revisions/commit`,
            {
                workflow_revision: {
                    workflow_id: workflowId,
                    flags: payload.flags,
                    data: payload.data,
                },
            },
            {params: {project_id: projectId}},
        )

        const validatedRevision = safeParseWithLogging(
            workflowRevisionResponseSchema,
            commitResponse.data,
            "[createWorkflow:revision]",
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
 * Request body for updating a workflow.
 *
 * Updates workflow metadata and/or commits a new revision with updated data.
 */
export interface UpdateWorkflowPayload {
    id: string
    name?: string | null
    description?: string | null
    flags?: WorkflowFlags
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
 * Update an existing workflow.
 *
 * If `data` is provided, commits a new revision.
 * Otherwise, updates workflow metadata only.
 *
 * @param projectId - Project ID
 * @param payload - Workflow update data (must include `id` = workflow ID)
 * @returns The updated workflow (revision with data)
 */
export async function updateWorkflow(
    projectId: string,
    payload: UpdateWorkflowPayload,
): Promise<Workflow> {
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
                    flags: payload.flags,
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
                    flags: payload.flags,
                    data: payload.data,
                },
            },
            {params: {project_id: projectId}},
        )

        const validatedRevision = safeParseWithLogging(
            workflowRevisionResponseSchema,
            commitResponse.data,
            "[updateWorkflow:revision]",
        )
        if (validatedRevision?.workflow_revision) {
            return validatedRevision.workflow_revision
        }
    }

    // Fall back to fetching the latest revision
    return fetchWorkflow({id: payload.id, projectId})
}

// ============================================================================
// ARCHIVE (Soft Delete)
// ============================================================================

/**
 * Archive (soft delete) a workflow.
 *
 * Endpoint: `POST /preview/workflows/{id}/archive`
 *
 * @param projectId - Project ID
 * @param workflowId - Workflow ID to archive
 * @returns The archived workflow response
 */
export async function archiveWorkflow(
    projectId: string,
    workflowId: string,
): Promise<WorkflowResponse> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/workflows/${workflowId}/archive`,
        {},
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        workflowResponseSchema,
        response.data,
        "[archiveWorkflow]",
    )
    return validated ?? {count: 0, workflow: null}
}

// ============================================================================
// UNARCHIVE
// ============================================================================

/**
 * Unarchive (restore) a workflow.
 *
 * Endpoint: `POST /preview/workflows/{id}/unarchive`
 *
 * @param projectId - Project ID
 * @param workflowId - Workflow ID to unarchive
 * @returns The restored workflow response
 */
export async function unarchiveWorkflow(
    projectId: string,
    workflowId: string,
): Promise<WorkflowResponse> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/workflows/${workflowId}/unarchive`,
        {},
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        workflowResponseSchema,
        response.data,
        "[unarchiveWorkflow]",
    )
    return validated ?? {count: 0, workflow: null}
}

// ============================================================================
// BATCH FETCH
// ============================================================================

/**
 * Batch fetch workflow revisions by workflow IDs.
 *
 * Uses the revision query endpoint with workflow_refs to fetch latest revisions.
 *
 * Endpoint: `POST /preview/workflows/revisions/query`
 *
 * @param projectId - Project ID
 * @param workflowIds - Array of workflow IDs to fetch revisions for
 * @returns Map of workflow ID → Workflow (revision with data)
 */
export async function fetchWorkflowsBatch(
    projectId: string,
    workflowIds: string[],
): Promise<Map<string, Workflow>> {
    const results = new Map<string, Workflow>()
    const groupedByWorkflowId = new Map<string, Workflow[]>()

    if (!projectId || workflowIds.length === 0) return results

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/workflows/revisions/query`,
        {
            workflow_refs: workflowIds.map((id) => ({id})),
        },
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        workflowRevisionsResponseSchema,
        response.data,
        "[fetchWorkflowsBatch]",
    )
    if (!validated) return results

    for (const raw of validated.workflow_revisions) {
        try {
            const workflow = safeParseWithLogging(workflowSchema, raw, "[fetchWorkflowsBatch:item]")
            if (workflow) {
                // Key by workflow_id so callers can look up by the workflow ID they passed in
                const key = workflow.workflow_id ?? workflow.id
                const current = groupedByWorkflowId.get(key) ?? []
                groupedByWorkflowId.set(key, [...current, workflow])
            }
        } catch (e) {
            console.error("[fetchWorkflowsBatch] Failed to parse workflow:", e, raw)
        }
    }

    for (const workflowId of workflowIds) {
        const candidates = groupedByWorkflowId.get(workflowId) ?? []
        const mostRecent = selectMostRecentWorkflowRevision(candidates)
        if (mostRecent) {
            results.set(workflowId, mostRecent)
        }
    }

    return results
}
