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
import {dereferenceSchema, generateId} from "@agenta/shared/utils"

import {parseRevisionUri, safeParseWithLogging} from "../../shared"
import {extractAllEndpointSchemas, type OpenAPISpec} from "../../shared/openapi"
import {
    workflowSchema,
    workflowResponseSchema,
    workflowsResponseSchema,
    workflowRevisionResponseSchema,
    workflowRevisionsResponseSchema,
    workflowVariantResponseSchema,
    workflowVariantsResponseSchema,
    type Workflow,
    type WorkflowVariant,
    type WorkflowResponse,
    type WorkflowsResponse,
    type WorkflowVariantResponse,
    type WorkflowVariantsResponse,
    type WorkflowRevisionResponse,
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
        // Skip v0 revisions (auto-created initial revisions with no useful data)
        if ((workflow.version ?? 0) === 0) continue
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
    name,
    flags,
    folderId,
    includeArchived = false,
    windowing,
}: WorkflowListParams): Promise<WorkflowsResponse> {
    if (!projectId) {
        return {count: 0, workflows: []}
    }

    // Build the workflow query object.
    // folder_id is only included when folderId is explicitly provided (not undefined).
    // null → root-level items (IS NULL), string → items in that folder.
    const hasFolderFilter = folderId !== undefined
    const hasWorkflowQuery = Boolean(name || flags || hasFolderFilter)
    const workflowQuery = hasWorkflowQuery
        ? {
              ...(name ? {name} : {}),
              ...(flags ? {flags} : {}),
              ...(hasFolderFilter ? {folder_id: folderId} : {}),
          }
        : undefined

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/workflows/query`,
        {
            workflow: workflowQuery,
            include_archived: includeArchived,
            windowing: windowing ?? undefined,
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
 * Windowing parameters for paginated revision queries.
 */
export interface WorkflowRevisionWindowing {
    next?: string | null
    limit?: number
    order?: string
}

/**
 * Query workflow revisions directly by workflow ID.
 * Skips the variant level — used for the 2-level selection hierarchy.
 *
 * Endpoint: `POST /preview/workflows/revisions/query`
 *
 * @param workflowId - The workflow ID
 * @param projectId - Project ID
 * @param flags - Optional query flags for filtering
 * @param windowing - Optional windowing params for pagination
 * @returns Revisions response with workflow_revisions array
 */
export async function queryWorkflowRevisionsByWorkflow(
    workflowId: string,
    projectId: string,
    flags?: WorkflowQueryFlags,
    windowing?: WorkflowRevisionWindowing,
    /** Optional name filter — server applies ilike matching */
    name?: string,
): Promise<WorkflowRevisionsResponse> {
    return queryWorkflowRevisionsByWorkflows([workflowId], projectId, flags, windowing, name)
}

/**
 * Query workflow revisions across multiple workflows.
 *
 * Endpoint: `POST /preview/workflows/revisions/query`
 *
 * @param workflowIds - Array of workflow IDs to fetch revisions for
 * @param projectId - Project ID
 * @param flags - Optional query flags for filtering
 * @param windowing - Optional windowing params for cursor-based pagination
 * @returns Revisions response with workflow_revisions array and windowing cursor
 */
export async function queryWorkflowRevisionsByWorkflows(
    workflowIds: string[],
    projectId: string,
    flags?: WorkflowQueryFlags,
    windowing?: WorkflowRevisionWindowing,
    /** Optional name filter — server applies ilike matching */
    name?: string,
): Promise<WorkflowRevisionsResponse> {
    if (!projectId || workflowIds.length === 0) {
        return {count: 0, workflow_revisions: []}
    }

    const hasRevisionQuery = flags || name
    const workflowRevision = hasRevisionQuery
        ? {
              ...(flags ? {flags} : {}),
              ...(name ? {name} : {}),
          }
        : undefined

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/workflows/revisions/query`,
        {
            workflow_refs: workflowIds.map((id) => ({id})),
            workflow_revision: workflowRevision,
            ...(windowing ? {windowing} : {}),
        },
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        workflowRevisionsResponseSchema,
        response.data,
        "[queryWorkflowRevisionsByWorkflows]",
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
    /** New shape (feat/extend-runnables): revision contains the resolved data */
    revision?: {
        uri?: string
        url?: string
        headers?: Record<string, unknown>
        schemas?: {
            parameters?: Record<string, unknown>
            inputs?: Record<string, unknown>
            outputs?: Record<string, unknown>
        }
        parameters?: Record<string, unknown>
    }
    /** @deprecated Old shape — kept for backward compat during migration */
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
 * The inspect endpoint on the service URL resolves the full schema from
 * the handler registered for the given URI.
 *
 * Calls `POST {serviceUrl}/inspect` directly on the service.
 *
 * @param uri - The workflow URI (e.g., "agenta:builtin:auto_exact_match:v0")
 * @param projectId - Project ID
 * @param serviceUrl - The service URL from `workflowRevision.data.url`
 * @returns Resolved interface with full schemas
 */
export async function inspectWorkflow(
    uri: string,
    projectId: string,
    serviceUrl?: string | null,
): Promise<InspectWorkflowResponse> {
    if (!projectId || !uri) {
        return {}
    }

    const baseUrl = serviceUrl?.replace(/\/+$/, "")
    if (!baseUrl) {
        return {}
    }

    const response = await axios.post(
        `${baseUrl}/inspect`,
        {
            revision: {uri},
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
    /** Route path parsed from the app URL (e.g., "agent/v1") */
    routePath?: string
    /** Runtime prefix (protocol + host) parsed from the app URL */
    runtimePrefix?: string
    /** Full dereferenced OpenAPI spec (needed for buildRequestBody) */
    openApiSchema?: unknown
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
            routePath: routePath || undefined,
            runtimePrefix: uriInfo.runtimePrefix,
            openApiSchema: dereferencedSchema,
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
 * Role flags settable by the frontend — the only flags the FE may send.
 * URI-derived and interface-derived flags are computed by the backend from revision data.
 */
export type WorkflowRoleFlags = Partial<
    Pick<NonNullable<WorkflowFlags>, "is_application" | "is_evaluator" | "is_snippet">
>

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
    flags?: WorkflowRoleFlags
    tags?: string[] | null
    meta?: Record<string, unknown> | null
    /** Commit message for the initial revision */
    message?: string | null
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
 * Infer revision-level flags from a workflow URI.
 *
 * URI format: `provider:kind:key:version` (e.g. `agenta:builtin:chat:v0`).
 * The backend's `infer_flags_from_data` infers most flags from the URI at commit
 * time, but `is_chat` is classified as schema-derived and is not inferred there.
 * We send it explicitly so the revision is correctly flagged from the start.
 */
function inferRevisionFlagsFromUri(
    uri: string | null | undefined,
): Record<string, boolean> | undefined {
    if (!uri) return undefined
    const parts = uri.split(":")
    const key = parts[2] // provider:kind:key:version
    if (!key) return undefined

    const flags: Record<string, boolean> = {}
    if (key === "chat") flags.is_chat = true

    return Object.keys(flags).length > 0 ? flags : undefined
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

    // Step 2: Create a default variant (revisions require a variant_id)
    const DEFAULT_VARIANT_NAME = "default"
    const variantSlug = `${payload.slug}.${DEFAULT_VARIANT_NAME}`
    const variantResponse = await axios.post(
        `${getAgentaApiUrl()}/preview/workflows/variants/`,
        {
            workflow_variant: {
                workflow_id: workflowId,
                slug: variantSlug,
                name: DEFAULT_VARIANT_NAME,
            },
        },
        {params: {project_id: projectId}},
    )

    const validatedVariant = safeParseWithLogging(
        workflowVariantResponseSchema,
        variantResponse.data,
        "[createWorkflow:variant]",
    )
    if (!validatedVariant?.workflow_variant) {
        throw new Error("[createWorkflow] Failed to create workflow variant")
    }

    const variantId = validatedVariant.workflow_variant.id

    // Step 3: Commit seed revision (v0) — tables dismiss v0, so the
    // user-visible first version must be v1.
    //
    // Use the workflow name for both revisions. The default variant remains
    // named "default", but the persisted revision name should reflect the
    // user-entered workflow/evaluator name.
    if (payload.data) {
        await axios.post(
            `${getAgentaApiUrl()}/preview/workflows/revisions/commit`,
            {
                workflow_revision: {
                    workflow_id: workflowId,
                    workflow_variant_id: variantId,
                    slug: generateId().replace(/-/g, "").slice(0, 12),
                    name: payload.name,
                    message: "Initial commit",
                },
            },
            {params: {project_id: projectId}},
        )

        // Step 4: Commit actual data revision (v1) with full parameters
        const revisionFlags = inferRevisionFlagsFromUri(payload.data?.uri)
        const commitResponse = await axios.post(
            `${getAgentaApiUrl()}/preview/workflows/revisions/commit`,
            {
                workflow_revision: {
                    workflow_id: workflowId,
                    workflow_variant_id: variantId,
                    slug: generateId().replace(/-/g, "").slice(0, 12),
                    name: payload.name,
                    data: payload.data,
                    flags: revisionFlags,
                    message: payload.message ?? undefined,
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
// CREATE VARIANT
// ============================================================================

/**
 * Request body for creating a workflow variant.
 */
export interface CreateWorkflowVariantPayload {
    /** Parent workflow ID */
    workflowId: string
    /** Slug for the new variant */
    slug: string
    /** Display name */
    name: string
}

/**
 * Create a new workflow variant under an existing workflow.
 *
 * Endpoint: `POST /preview/workflows/variants/`
 *
 * @param projectId - Project ID
 * @param payload - Variant creation data
 * @returns The created workflow variant
 */
export async function createWorkflowVariantApi(
    projectId: string,
    payload: CreateWorkflowVariantPayload,
): Promise<WorkflowVariant | null> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/workflows/variants/`,
        {
            workflow_variant: {
                workflow_id: payload.workflowId,
                slug: payload.slug,
                name: payload.name,
            },
        },
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        workflowVariantResponseSchema,
        response.data,
        "[createWorkflowVariantApi]",
    )
    return validated?.workflow_variant ?? null
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
    /** Variant ID for revision commit (workflow_variant_id → variant_id on backend) */
    variantId?: string | null
    name?: string | null
    description?: string | null
    flags?: WorkflowRoleFlags
    tags?: string[] | null
    meta?: Record<string, unknown> | null
    /** Commit message for the new revision */
    message?: string | null
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
        const revisionFlags = inferRevisionFlagsFromUri(payload.data?.uri)
        const commitResponse = await axios.post(
            `${getAgentaApiUrl()}/preview/workflows/revisions/commit`,
            {
                workflow_revision: {
                    workflow_id: payload.id,
                    workflow_variant_id: payload.variantId ?? undefined,
                    slug: generateId().replace(/-/g, "").slice(0, 12),
                    name: payload.name ?? undefined,
                    data: payload.data,
                    flags: revisionFlags,
                    message: payload.message ?? undefined,
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
// COMMIT REVISION
// ============================================================================

/**
 * Commit a new workflow revision.
 *
 * Endpoint: `POST /preview/workflows/revisions/commit`
 *
 * This function ONLY creates a new revision — it does NOT update
 * artifact-level metadata (name, flags, tags). Use `updateWorkflow`
 * (which calls `PUT /preview/workflows/{id}`) for metadata edits.
 */
export interface CommitWorkflowRevisionPayload {
    workflowId: string
    variantId?: string
    slug?: string
    name?: string
    data: NonNullable<UpdateWorkflowPayload["data"]>
    message?: string
}

export async function commitWorkflowRevisionApi(
    projectId: string,
    payload: CommitWorkflowRevisionPayload,
): Promise<Workflow> {
    const revisionFlags = inferRevisionFlagsFromUri(payload.data?.uri)
    const commitResponse = await axios.post(
        `${getAgentaApiUrl()}/preview/workflows/revisions/commit`,
        {
            workflow_revision: {
                workflow_id: payload.workflowId,
                workflow_variant_id: payload.variantId ?? undefined,
                slug: payload.slug ?? generateId().replace(/-/g, "").slice(0, 12),
                name: payload.name ?? undefined,
                data: payload.data,
                flags: revisionFlags,
                message: payload.message ?? undefined,
            },
        },
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        workflowRevisionResponseSchema,
        commitResponse.data,
        "[commitWorkflowRevisionApi]",
    )
    if (validated?.workflow_revision) {
        return validated.workflow_revision
    }

    // Fallback: fetch the latest revision
    return fetchWorkflow({id: payload.workflowId, projectId})
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

/**
 * Archive (soft delete) a single workflow revision.
 *
 * Endpoint: `POST /preview/workflows/revisions/{revision_id}/archive`
 *
 * Unlike `archiveWorkflow` which archives the entire artifact (all variants
 * and revisions), this function archives only a single revision.
 */
export async function archiveWorkflowRevision(
    projectId: string,
    revisionId: string,
): Promise<WorkflowRevisionResponse> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/workflows/revisions/${revisionId}/archive`,
        {},
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        workflowRevisionResponseSchema,
        response.data,
        "[archiveWorkflowRevision]",
    )
    return validated ?? {count: 0, workflow_revision: null}
}

/**
 * Archive (soft delete) a single workflow variant.
 *
 * Endpoint: `POST /preview/workflows/variants/{variant_id}/archive`
 *
 * Used to clean up orphaned variants after their last revision is archived.
 */
export async function archiveWorkflowVariant(
    projectId: string,
    variantId: string,
): Promise<WorkflowVariantResponse> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/workflows/variants/${variantId}/archive`,
        {},
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        workflowVariantResponseSchema,
        response.data,
        "[archiveWorkflowVariant]",
    )
    return validated ?? {count: 0, workflow_variant: null}
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
            // When fetching for a single workflow, limit to 1 (latest) to reduce payload.
            // With multiple workflows the global limit would cut across all, so skip it.
            ...(workflowIds.length === 1 ? {windowing: {limit: 1, order: "descending"}} : {}),
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

/**
 * Batch fetch workflow revisions by revision IDs.
 *
 * Uses the revision query endpoint with workflow_revision_refs to fetch
 * specific revisions by their IDs in a single request.
 *
 * Endpoint: `POST /preview/workflows/revisions/query`
 *
 * @param projectId - Project ID
 * @param revisionIds - Array of revision IDs to fetch
 * @returns Map of revision ID → Workflow
 */
export async function fetchWorkflowRevisionsByIdsBatch(
    projectId: string,
    revisionIds: string[],
): Promise<Map<string, Workflow>> {
    const results = new Map<string, Workflow>()

    if (!projectId || revisionIds.length === 0) return results

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/workflows/revisions/query`,
        {
            workflow_revision_refs: revisionIds.map((id) => ({id})),
        },
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        workflowRevisionsResponseSchema,
        response.data,
        "[fetchWorkflowRevisionsByIdsBatch]",
    )
    if (!validated) return results

    for (const raw of validated.workflow_revisions) {
        try {
            const workflow = safeParseWithLogging(
                workflowSchema,
                raw,
                "[fetchWorkflowRevisionsByIdsBatch:item]",
            )
            if (workflow) {
                results.set(workflow.id, workflow)
            }
        } catch (e) {
            console.error("[fetchWorkflowRevisionsByIdsBatch] Failed to parse workflow:", e, raw)
        }
    }

    return results
}

/**
 * Fetch the full dereferenced JSON Schema for an x-ag-type-ref target.
 *
 * Used to resolve semantic refs (e.g. "prompt-template") into
 * rich sub-property schemas so the frontend can render proper config controls.
 *
 * @param agType - The referenced ag-type key, e.g. "prompt-template"
 * @returns The dereferenced JSON Schema for the ag-type
 */
export async function fetchAgTypeSchema(agType: string): Promise<Record<string, unknown>> {
    const response = await axios.get(
        `${getAgentaApiUrl()}/workflows/catalog/types/${encodeURIComponent(agType)}`,
    )
    const jsonSchema = response.data?.type?.json_schema

    if (!jsonSchema || typeof jsonSchema !== "object") {
        throw new Error(`[fetchAgTypeSchema] Invalid catalog type response for agType=${agType}`)
    }

    return jsonSchema as Record<string, unknown>
}

// ============================================================================
// WORKFLOW CATALOG
// ============================================================================

export interface WorkflowCatalogFlags {
    is_archived?: boolean
    is_recommended?: boolean
    is_application?: boolean
    is_evaluator?: boolean
    is_snippet?: boolean
}

export interface WorkflowCatalogTemplate {
    key: string
    name?: string | null
    description?: string | null
    categories?: string[] | null
    flags?: WorkflowCatalogFlags | null
    data?: {
        uri?: string
        schemas?: {
            parameters?: Record<string, unknown>
            inputs?: Record<string, unknown>
            outputs?: Record<string, unknown>
        }
        parameters?: Record<string, unknown>
    } | null
    presets?: WorkflowCatalogPreset[] | null
}

export interface WorkflowCatalogPreset {
    key: string
    name?: string | null
    description?: string | null
    categories?: string[] | null
    flags?: WorkflowCatalogFlags | null
    data?: {
        uri?: string
        parameters?: Record<string, unknown>
    } | null
}

export interface WorkflowCatalogTemplatesResponse {
    count: number
    templates: WorkflowCatalogTemplate[]
}

/**
 * Fetch workflow catalog templates with optional flag filtering.
 *
 * @param params.isApplication - Filter for application templates (completion, chat, etc.)
 * @param params.isEvaluator - Filter for evaluator templates
 * @param params.isSnippet - Filter for snippet templates
 */
export async function fetchWorkflowCatalogTemplates(params?: {
    isApplication?: boolean
    isEvaluator?: boolean
    isSnippet?: boolean
    includeArchived?: boolean
}): Promise<WorkflowCatalogTemplatesResponse> {
    const queryParams: Record<string, unknown> = {}
    if (params?.isApplication !== undefined) queryParams.is_application = params.isApplication
    if (params?.isEvaluator !== undefined) queryParams.is_evaluator = params.isEvaluator
    if (params?.isSnippet !== undefined) queryParams.is_snippet = params.isSnippet
    if (params?.includeArchived !== undefined) queryParams.include_archived = params.includeArchived

    const response = await axios.get<WorkflowCatalogTemplatesResponse>(
        `${getAgentaApiUrl()}/workflows/catalog/templates/`,
        {params: queryParams},
    )
    return response.data ?? {count: 0, templates: []}
}
