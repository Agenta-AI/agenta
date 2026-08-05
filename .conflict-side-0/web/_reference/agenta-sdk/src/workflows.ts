/**
 * Agenta TypeScript SDK — Workflows manager.
 *
 * Workflows are the unified entity behind both applications and evaluators.
 * Use `flags: { is_evaluator: true }` to create evaluators,
 * or `flags: { is_application: true }` for apps.
 *
 * This mirrors the frontend's workflow API at:
 *   web/packages/agenta-entities/src/workflow/api/api.ts
 *
 * Endpoints:
 *   Workflows:
 *     POST /preview/workflows/query              → query
 *     POST /preview/workflows/                    → create (step 1)
 *     PUT  /preview/workflows/:id                 → edit metadata
 *     POST /preview/workflows/:id/archive         → archive
 *     POST /preview/workflows/:id/unarchive       → unarchive
 *
 *   Variants:
 *     POST /preview/workflows/variants/           → createVariant
 *     POST /preview/workflows/variants/query      → queryVariants
 *     POST /preview/workflows/variants/:id/archive → archiveVariant
 *
 *   Revisions:
 *     POST /preview/workflows/revisions/commit    → commitRevision
 *     POST /preview/workflows/revisions/query     → queryRevisions
 *     GET  /preview/workflows/revisions/:id       → getRevision
 *     POST /preview/workflows/revisions/:id/archive → archiveRevision
 *
 *   Interface:
 *     POST /preview/workflows/interfaces/schemas  → fetchInterfaceSchemas
 */

import {schemas, validateBoundary, type SchemaOf} from "./.generated/index"
import type {AgentaClient} from "./client"
import type {
    Windowing,
    Workflow,
    WorkflowFlags,
    WorkflowQueryFlags,
    WorkflowData,
    WorkflowVariant,
    WorkflowCreateRequest,
    WorkflowEditRequest,
    WorkflowQueryRequest,
    WorkflowVariantCreateRequest,
    WorkflowRevisionCommitRequest,
    WorkflowRevisionsQueryRequest,
    WorkflowResponse,
    WorkflowsResponse,
    WorkflowVariantResponse,
    WorkflowVariantsResponse,
    WorkflowRevisionResponse,
    WorkflowRevisionsResponse,
    WorkflowCatalogTemplate,
    WorkflowCatalogTemplateResponse,
    WorkflowCatalogTemplatesResponse,
} from "./types"

function generateSlug(): string {
    return Math.random().toString(36).slice(2, 14)
}

export class Workflows {
    constructor(private readonly client: AgentaClient) {}

    // ─── Query / List ──────────────────────────────────────────────────────────

    /**
     * Query workflows with optional flag filters and pagination.
     *
     * POST /preview/workflows/query
     *
     * Use `flags: { is_evaluator: true }` to list evaluators only.
     * Use `flags: { is_application: true }` to list apps only.
     */
    async query(options?: {
        name?: string
        flags?: WorkflowQueryFlags
        folderId?: string | null
        includeArchived?: boolean
        windowing?: Windowing
    }): Promise<WorkflowsResponse> {
        const hasFolderFilter = options?.folderId !== undefined
        const hasQuery = Boolean(options?.name || options?.flags || hasFolderFilter)

        const body: WorkflowQueryRequest = {
            workflow: hasQuery
                ? {
                      ...(options?.name ? {name: options.name} : {}),
                      ...(options?.flags ? {flags: options.flags} : {}),
                      ...(hasFolderFilter ? {folder_id: options?.folderId} : {}),
                  }
                : undefined,
            include_archived: options?.includeArchived,
            windowing: options?.windowing,
        }
        const raw = await this.client.post<WorkflowsResponse>("/workflows/query", body)
        // Boundary validation against the OpenAPI-derived schema. Drift logs
        // a one-line warning; data passes through unchanged. See the Zod
        // pattern in `Prompts.fetch` for the same shape.
        return validateBoundary(
            raw,
            schemas.WorkflowsResponse,
            "Workflows.query",
        ) as WorkflowsResponse
    }

    /**
     * List all evaluators.
     * Convenience wrapper: queries workflows with `is_evaluator: true`.
     */
    async listEvaluators(options?: {
        includeArchived?: boolean
        windowing?: Windowing
    }): Promise<Workflow[]> {
        const res = await this.query({
            flags: {is_evaluator: true},
            ...options,
        })
        return res.workflows
    }

    /**
     * List all applications.
     * Convenience wrapper: queries workflows with `is_application: true`.
     */
    async listApplications(options?: {
        includeArchived?: boolean
        windowing?: Windowing
    }): Promise<Workflow[]> {
        const res = await this.query({
            flags: {is_application: true},
            ...options,
        })
        return res.workflows
    }

    // ─── Catalog Templates ─────────────────────────────────────────────────────

    /**
     * List workflow catalog templates (applications/evaluators/snippets).
     *
     * GET /preview/workflows/catalog/templates/
     */
    async listTemplates(options?: {
        isApplication?: boolean
        isEvaluator?: boolean
        includeArchived?: boolean
    }): Promise<WorkflowCatalogTemplate[]> {
        const params: Record<string, string> = {}
        if (options?.isApplication) params.is_application = "true"
        if (options?.isEvaluator) params.is_evaluator = "true"
        if (options?.includeArchived) params.include_archived = "true"

        const res = await this.client.get<WorkflowCatalogTemplatesResponse>(
            "/workflows/catalog/templates/",
            {params: Object.keys(params).length > 0 ? params : undefined},
        )
        return res.templates
    }

    /**
     * Get a workflow catalog template by key.
     *
     * GET /preview/workflows/catalog/templates/:key
     */
    async getTemplate(key: string): Promise<WorkflowCatalogTemplate | null> {
        const res = await this.client.get<WorkflowCatalogTemplateResponse>(
            `/workflows/catalog/templates/${key}`,
        )
        return res.template ?? null
    }

    /**
     * Resolve a workflow catalog template by builtin URI.
     */
    async findTemplateByUri(
        uri: string,
        options?: {isApplication?: boolean; isEvaluator?: boolean},
    ): Promise<WorkflowCatalogTemplate | null> {
        const templates = await this.listTemplates(options)
        return templates.find((t) => t.data?.uri === uri) ?? null
    }

    // ─── Create ────────────────────────────────────────────────────────────────

    /**
     * Create a new workflow with an initial revision.
     *
     * Mirrors the frontend createWorkflow pattern:
     * 1. POST /preview/workflows/ (create workflow)
     * 2. POST /preview/workflows/variants/ (create default variant)
     * 3. POST /preview/workflows/revisions/commit (commit seed v0)
     * 4. POST /preview/workflows/revisions/commit (commit data v1)
     */
    async create(options: {
        slug: string
        name: string
        description?: string
        flags?: WorkflowFlags
        catalogTemplateKey?: string
        tags?: string[]
        meta?: Record<string, unknown>
        message?: string
        data?: WorkflowData
    }): Promise<Workflow> {
        const mergedData = await this.resolveInitialDataFromCatalog(
            options.data,
            options.flags,
            options.catalogTemplateKey,
        )

        // Step 1: Create the workflow
        const workflowBody: WorkflowCreateRequest = {
            workflow: {
                slug: options.slug,
                name: options.name,
                description: options.description,
                flags: options.flags,
                tags: options.tags,
                meta: options.meta,
            },
        }
        const workflowRes = await this.client.post<WorkflowResponse>("/workflows/", workflowBody)
        if (!workflowRes.workflow) {
            throw new Error("[Workflows.create] Failed to create workflow")
        }
        const workflowId = workflowRes.workflow.id

        // Step 2: Create a default variant
        const variantBody: WorkflowVariantCreateRequest = {
            workflow_variant: {
                workflow_id: workflowId,
                slug: generateSlug(),
                name: options.name,
            },
        }
        const variantRes = await this.client.post<WorkflowVariantResponse>(
            "/workflows/variants/",
            variantBody,
        )
        if (!variantRes.workflow_variant) {
            throw new Error("[Workflows.create] Failed to create variant")
        }
        const variantId = variantRes.workflow_variant.id

        // Step 3+4: Commit revisions if data provided
        if (mergedData) {
            // Seed revision (v0) — just uri/url
            await this.client.post<WorkflowRevisionResponse>("/workflows/revisions/commit", {
                workflow_revision: {
                    workflow_id: workflowId,
                    variant_id: variantId,
                    slug: generateSlug(),
                    name: options.name,
                    flags: options.flags,
                    data: {
                        uri: mergedData.uri,
                        url: mergedData.url,
                    },
                },
            } satisfies WorkflowRevisionCommitRequest)

            // Data revision (v1) — full parameters
            const commitRes = await this.client.post<WorkflowRevisionResponse>(
                "/workflows/revisions/commit",
                {
                    workflow_revision: {
                        workflow_id: workflowId,
                        variant_id: variantId,
                        slug: generateSlug(),
                        name: options.name,
                        flags: options.flags,
                        data: mergedData,
                        message: options.message,
                    },
                } satisfies WorkflowRevisionCommitRequest,
            )

            if (commitRes.workflow_revision) {
                return commitRes.workflow_revision
            }
        }

        return workflowRes.workflow
    }

    /**
     * Create an evaluator workflow.
     * Convenience wrapper that sets the right flags.
     */
    async createEvaluator(options: {
        slug: string
        name: string
        description?: string
        isHuman?: boolean
        catalogTemplateKey?: string
        data?: WorkflowData
        message?: string
    }): Promise<Workflow> {
        return this.create({
            slug: options.slug,
            name: options.name,
            description: options.description,
            catalogTemplateKey: options.catalogTemplateKey,
            flags: {
                is_evaluator: true,
                is_human: options.isHuman ?? false,
            },
            data: options.data,
            message: options.message,
        })
    }

    // ─── Update / Edit ─────────────────────────────────────────────────────────

    /**
     * Update workflow metadata (name, description, flags, tags).
     * Does NOT create a new revision — use commitRevision for data changes.
     *
     * PUT /preview/workflows/:id
     */
    async edit(options: {
        id: string
        name?: string
        description?: string
        flags?: WorkflowFlags
        tags?: string[]
        meta?: Record<string, unknown>
    }): Promise<WorkflowResponse> {
        const body: WorkflowEditRequest = {
            workflow: {
                id: options.id,
                name: options.name,
                description: options.description,
                flags: options.flags,
                tags: options.tags,
                meta: options.meta,
            },
        }
        return this.client.put<WorkflowResponse>(`/workflows/${options.id}`, body)
    }

    /**
     * Update a workflow: edits metadata + commits a new revision if data provided.
     * Mirrors the frontend updateWorkflow pattern.
     */
    async update(options: {
        id: string
        variantId?: string
        name?: string
        description?: string
        flags?: WorkflowFlags
        tags?: string[]
        meta?: Record<string, unknown>
        data?: WorkflowData
        message?: string
    }): Promise<Workflow> {
        // Update metadata
        const hasMetadataChanges =
            options.name || options.description || options.flags || options.tags
        if (hasMetadataChanges) {
            await this.edit(options)
        }

        // Commit new revision if data changed
        if (options.data) {
            const revision = await this.commitRevision({
                workflowId: options.id,
                variantId: options.variantId,
                name: options.name,
                flags: options.flags,
                data: options.data,
                message: options.message,
            })
            return revision
        }

        // Fallback: fetch the latest revision
        return this.fetchLatest(options.id)
    }

    // ─── Revisions ─────────────────────────────────────────────────────────────

    /**
     * Commit a new workflow revision.
     *
     * POST /preview/workflows/revisions/commit
     */
    async commitRevision(options: {
        workflowId: string
        variantId?: string
        slug?: string
        name?: string
        flags?: WorkflowFlags
        data: WorkflowData
        message?: string
    }): Promise<Workflow> {
        const body: WorkflowRevisionCommitRequest = {
            workflow_revision: {
                workflow_id: options.workflowId,
                workflow_variant_id: options.variantId,
                slug: options.slug ?? generateSlug(),
                name: options.name,
                flags: options.flags,
                data: options.data,
                message: options.message,
            },
        }
        const res = await this.client.post<WorkflowRevisionResponse>(
            "/workflows/revisions/commit",
            body,
        )
        if (res.workflow_revision) {
            return res.workflow_revision
        }
        return this.fetchLatest(options.workflowId)
    }

    /**
     * Query revisions by workflow IDs.
     *
     * POST /preview/workflows/revisions/query
     */
    async queryRevisions(options: {
        workflowIds?: string[]
        variantIds?: string[]
        flags?: WorkflowQueryFlags
        includeArchived?: boolean
        windowing?: Windowing
    }): Promise<WorkflowRevisionsResponse> {
        const body: WorkflowRevisionsQueryRequest = {
            workflow_refs: options.workflowIds?.map((id) => ({id})),
            workflow_variant_refs: options.variantIds?.map((id) => ({id})),
            workflow_revision: options.flags ? {flags: options.flags} : undefined,
            include_archived: options.includeArchived,
            windowing: options.windowing,
        }
        return this.client.post<WorkflowRevisionsResponse>("/workflows/revisions/query", body)
    }

    /**
     * Get a single revision by ID.
     *
     * GET /preview/workflows/revisions/:id
     */
    async getRevision(revisionId: string): Promise<Workflow | null> {
        const res = await this.client.get<WorkflowRevisionResponse>(
            `/workflows/revisions/${revisionId}`,
        )
        return res.workflow_revision ?? null
    }

    /**
     * Archive a single revision.
     */
    async archiveRevision(revisionId: string): Promise<WorkflowRevisionResponse> {
        return this.client.post<WorkflowRevisionResponse>(
            `/workflows/revisions/${revisionId}/archive`,
        )
    }

    // ─── Variants ──────────────────────────────────────────────────────────────

    /**
     * Create a new variant under an existing workflow.
     *
     * POST /preview/workflows/variants/
     */
    async createVariant(options: {
        workflowId: string
        slug: string
        name: string
    }): Promise<WorkflowVariant | null> {
        const body: WorkflowVariantCreateRequest = {
            workflow_variant: {
                workflow_id: options.workflowId,
                slug: options.slug,
                name: options.name,
            },
        }
        const res = await this.client.post<WorkflowVariantResponse>("/workflows/variants/", body)
        return res.workflow_variant ?? null
    }

    /**
     * Query variants for a given workflow.
     *
     * POST /preview/workflows/variants/query
     */
    async queryVariants(
        workflowId: string,
        flags?: WorkflowQueryFlags,
    ): Promise<WorkflowVariantsResponse> {
        return this.client.post<WorkflowVariantsResponse>("/workflows/variants/query", {
            workflow_refs: [{id: workflowId}],
            workflow_variant: flags ? {flags} : undefined,
        })
    }

    /**
     * Archive a variant.
     */
    async archiveVariant(variantId: string): Promise<WorkflowVariantResponse> {
        return this.client.post<WorkflowVariantResponse>(`/workflows/variants/${variantId}/archive`)
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────────────

    /**
     * Archive a workflow (soft delete).
     */
    async archive(workflowId: string): Promise<WorkflowResponse> {
        return this.client.post<WorkflowResponse>(`/workflows/${workflowId}/archive`)
    }

    /**
     * Unarchive (restore) a workflow.
     */
    async unarchive(workflowId: string): Promise<WorkflowResponse> {
        return this.client.post<WorkflowResponse>(`/workflows/${workflowId}/unarchive`)
    }

    // ─── Interface Schemas ─────────────────────────────────────────────────────

    /**
     * Fetch interface schemas for a builtin workflow URI.
     *
     * POST /preview/workflows/interfaces/schemas
     */
    async fetchInterfaceSchemas(uri: string): Promise<{
        uri?: string
        schemas?: {
            parameters?: Record<string, unknown>
            inputs?: Record<string, unknown>
            outputs?: Record<string, unknown>
        }
    } | null> {
        try {
            return await this.client.post("/workflows/interfaces/schemas", {uri})
        } catch {
            return null
        }
    }

    // ─── Convenience ───────────────────────────────────────────────────────────

    /**
     * Find a workflow by slug.
     * Returns the workflow (artifact-level, no revision data) or null.
     */
    async findBySlug(slug: string, flags?: WorkflowQueryFlags): Promise<Workflow | null> {
        const res = await this.query({flags})
        return res.workflows.find((w) => w.slug === slug) ?? null
    }

    /**
     * Find an evaluator by slug.
     * Convenience wrapper that queries with `is_evaluator: true`.
     */
    async findEvaluatorBySlug(slug: string): Promise<Workflow | null> {
        return this.findBySlug(slug, {is_evaluator: true})
    }

    /**
     * Fetch the latest revision for a workflow.
     * Queries revisions ordered by descending version, returns the first.
     */
    async fetchLatest(workflowId: string): Promise<Workflow> {
        const res = await this.queryRevisions({
            workflowIds: [workflowId],
            windowing: {limit: 1, order: "descending"},
        })
        if (res.workflow_revisions.length > 0) {
            return res.workflow_revisions[0]
        }
        throw new Error(`[Workflows.fetchLatest] No revision found for workflow_id=${workflowId}`)
    }

    // ─── Workflow execution ──────────────────────────────────────────────────

    /**
     * Inspect a workflow without invoking it. Returns the resolved configuration,
     * input/output schemas, and prompt parameters.
     *
     * NOTE: this endpoint is not exposed in the public-cloud OpenAPI spec
     * (the backend hasn't mounted `/workflows/inspect` to be visible). Calling
     * it may 404 in production. Track in `PARITY.md`. Return type stays
     * `unknown` until a schema is available.
     *
     * Body shape is loose; typical payload is `{ workflow_ref, workflow_revision_ref }`.
     */
    async inspect(request: Record<string, unknown>): Promise<unknown> {
        return this.client.post("/workflows/inspect", request)
    }

    /**
     * Invoke a workflow with inputs and return its outputs.
     *
     * NOTE: same caveat as `inspect` — `/workflows/invoke` is not in the
     * public-cloud OpenAPI surface. Untyped + unwrapped pending backend
     * route mount.
     */
    async invoke(request: Record<string, unknown>): Promise<unknown> {
        return this.client.post("/workflows/invoke", request)
    }

    // ─── Workflow revisions (additional ops) ─────────────────────────────────

    /** Retrieve a workflow revision by reference (slug, env, etc). */
    async retrieveRevision(
        request: Record<string, unknown>,
    ): Promise<SchemaOf<"WorkflowRevisionResponse">> {
        const raw = await this.client.post("/workflows/revisions/retrieve", request)
        return validateBoundary(raw, schemas.WorkflowRevisionResponse, "Workflows.retrieveRevision")
    }

    /** Get the revision history (git-style log) for a workflow. */
    async logRevisions(
        request: Record<string, unknown>,
    ): Promise<SchemaOf<"WorkflowRevisionsResponse">> {
        const raw = await this.client.post("/workflows/revisions/log", request)
        return validateBoundary(raw, schemas.WorkflowRevisionsResponse, "Workflows.logRevisions")
    }

    /** Restore an archived workflow revision. */
    async unarchiveRevision(revisionId: string): Promise<WorkflowVariantResponse> {
        return this.client.post<WorkflowVariantResponse>(
            `/workflows/revisions/${revisionId}/unarchive`,
        )
    }

    // ─── Workflow variants (additional ops) ──────────────────────────────────

    /** Fetch a single workflow variant by ID. */
    async getVariant(variantId: string): Promise<WorkflowVariantResponse> {
        return this.client.get<WorkflowVariantResponse>(`/workflows/variants/${variantId}`)
    }

    /**
     * Fork an existing workflow variant.
     * Body shape is loose; typical payload includes the source variant ref
     * and a new slug/name for the fork.
     */
    async forkVariant(request: Record<string, unknown>): Promise<WorkflowVariantResponse> {
        return this.client.post<WorkflowVariantResponse>("/workflows/variants/fork", request)
    }

    /** Restore an archived workflow variant. */
    async unarchiveVariant(variantId: string): Promise<WorkflowVariantResponse> {
        return this.client.post<WorkflowVariantResponse>(
            `/workflows/variants/${variantId}/unarchive`,
        )
    }

    private async resolveInitialDataFromCatalog(
        data: WorkflowData | undefined,
        flags: WorkflowFlags | undefined,
        catalogTemplateKey?: string,
    ): Promise<WorkflowData | undefined> {
        if (!data) return undefined

        const isApplication = !!flags?.is_application
        const isEvaluator = !!flags?.is_evaluator
        const uri = data.uri ?? undefined

        try {
            let template: WorkflowCatalogTemplate | null = null

            if (catalogTemplateKey) {
                template = await this.getTemplate(catalogTemplateKey)
            }

            if (!template && uri) {
                template = await this.findTemplateByUri(uri, {
                    isApplication,
                    isEvaluator,
                })
            }

            if (!template?.data) return data

            return mergeWorkflowData(template.data, data)
        } catch {
            return data
        }
    }
}

function mergeWorkflowData(base: WorkflowData, override: WorkflowData): WorkflowData {
    return {
        ...base,
        ...override,
        schemas: {
            ...(base.schemas ?? {}),
            ...(override.schemas ?? {}),
            parameters: {
                ...((base.schemas?.parameters as Record<string, unknown>) ?? {}),
                ...((override.schemas?.parameters as Record<string, unknown>) ?? {}),
            },
            inputs: {
                ...((base.schemas?.inputs as Record<string, unknown>) ?? {}),
                ...((override.schemas?.inputs as Record<string, unknown>) ?? {}),
            },
            outputs: {
                ...((base.schemas?.outputs as Record<string, unknown>) ?? {}),
                ...((override.schemas?.outputs as Record<string, unknown>) ?? {}),
            },
        },
        parameters: {
            ...((base.parameters as Record<string, unknown>) ?? {}),
            ...((override.parameters as Record<string, unknown>) ?? {}),
        },
    }
}
