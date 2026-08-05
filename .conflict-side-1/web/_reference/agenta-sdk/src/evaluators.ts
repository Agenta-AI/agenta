/**
 * Agenta TypeScript SDK — Evaluators manager.
 *
 * Surface (CRUD on simple evaluators, plus variant/revision operations):
 *
 *   Simple evaluator lifecycle:
 *     POST /preview/simple/evaluators/                     → create
 *     POST /preview/simple/evaluators/query                → query
 *     GET  /preview/simple/evaluators/:id                  → get
 *     PUT  /preview/simple/evaluators/:id                  → update
 *     POST /preview/simple/evaluators/:id/archive          → archive
 *     POST /preview/simple/evaluators/:id/unarchive        → unarchive
 *     POST /preview/simple/evaluators/:id/transfer         → transfer
 *
 *   Catalog:
 *     GET  /preview/evaluators/catalog/templates/          → listTemplates
 *     GET  /preview/evaluators/catalog/templates/:key      → getTemplate
 *     GET  /preview/evaluators/catalog/templates/:key/presets/  → listPresets
 *
 *   Revisions:
 *     POST /preview/evaluators/revisions/retrieve          → retrieveRevision
 *     POST /preview/evaluators/revisions/commit            → commitRevision
 *     GET  /preview/evaluators/revisions/:id               → getRevision
 *     POST /preview/evaluators/revisions/:id/archive       → archiveRevision
 *     POST /preview/evaluators/revisions/:id/unarchive     → unarchiveRevision
 *     POST /preview/evaluators/revisions/log               → logRevisions
 *     POST /preview/evaluators/revisions/query             → queryRevisions
 *
 *   Variants:
 *     POST /preview/evaluators/variants/                   → createVariant
 *     POST /preview/evaluators/variants/query              → queryVariants
 *     POST /preview/evaluators/variants/fork               → forkVariant
 *     GET  /preview/evaluators/variants/:id                → getVariant
 *     POST /preview/evaluators/variants/:id/archive        → archiveVariant
 *     POST /preview/evaluators/variants/:id/unarchive      → unarchiveVariant
 *
 * The "full" (non-simple) evaluator surface is intentionally not exposed in
 * v0.2; consumers who need it can hit `/preview/evaluators/...` via the raw
 * `AgentaClient`. See PARITY.md.
 */

import type {AgentaClient} from "./client"
import type {
    SimpleEvaluator,
    SimpleEvaluatorCreate,
    SimpleEvaluatorEdit,
    SimpleEvaluatorQuery,
    SimpleEvaluatorCreateRequest,
    SimpleEvaluatorEditRequest,
    SimpleEvaluatorQueryRequest,
    SimpleEvaluatorResponse,
    SimpleEvaluatorsResponse,
    EvaluatorRevision,
    EvaluatorRevisionCommit,
    EvaluatorRevisionCommitRequest,
    EvaluatorRevisionRetrieveRequest,
    EvaluatorRevisionResponse,
    EvaluatorRevisionsResponse,
    EvaluatorVariantResponse,
    EvaluatorVariantsResponse,
    EvaluatorCatalogTemplate,
    EvaluatorCatalogTemplateResponse,
    EvaluatorCatalogTemplatesResponse,
    EvaluatorCatalogPreset,
    EvaluatorCatalogPresetsResponse,
    Reference,
    Windowing,
} from "./types"

export class Evaluators {
    constructor(private readonly client: AgentaClient) {}

    /**
     * Query evaluators with optional filtering and pagination.
     */
    async query(options?: {
        filter?: SimpleEvaluatorQuery
        refs?: Reference[]
        includeArchived?: boolean
        windowing?: Windowing
    }): Promise<SimpleEvaluatorsResponse> {
        const body: SimpleEvaluatorQueryRequest = {
            evaluator: options?.filter,
            evaluator_refs: options?.refs,
            include_archived: options?.includeArchived,
            windowing: options?.windowing,
        }
        return this.client.post<SimpleEvaluatorsResponse>("/simple/evaluators/query", body)
    }

    /**
     * Fetch all evaluators (no filter, no pagination).
     */
    async list(): Promise<SimpleEvaluator[]> {
        const res = await this.query()
        return res.evaluators
    }

    /**
     * Get a single evaluator by ID.
     */
    async get(evaluatorId: string): Promise<SimpleEvaluator | null> {
        const res = await this.client.get<SimpleEvaluatorResponse>(
            `/simple/evaluators/${evaluatorId}`,
        )
        return res.evaluator ?? null
    }

    /**
     * Create a new evaluator.
     */
    async create(evaluator: SimpleEvaluatorCreate): Promise<SimpleEvaluatorResponse> {
        const body: SimpleEvaluatorCreateRequest = {evaluator}
        return this.client.post<SimpleEvaluatorResponse>("/simple/evaluators/", body)
    }

    /**
     * Update an existing evaluator.
     */
    async update(evaluator: SimpleEvaluatorEdit): Promise<SimpleEvaluatorResponse> {
        const body: SimpleEvaluatorEditRequest = {evaluator}
        return this.client.put<SimpleEvaluatorResponse>(`/simple/evaluators/${evaluator.id}`, body)
    }

    /**
     * Retrieve a specific evaluator revision.
     */
    async retrieveRevision(options: {
        evaluatorRef?: Reference
        evaluatorVariantRef?: Reference
        evaluatorRevisionRef?: Reference
        environmentRef?: Reference
        resolve?: boolean
    }): Promise<EvaluatorRevision | null> {
        const body: EvaluatorRevisionRetrieveRequest = {
            evaluator_ref: options.evaluatorRef,
            evaluator_variant_ref: options.evaluatorVariantRef,
            evaluator_revision_ref: options.evaluatorRevisionRef,
            environment_ref: options.environmentRef,
            resolve: options.resolve,
        }
        const res = await this.client.post<EvaluatorRevisionResponse>(
            "/evaluators/revisions/retrieve",
            body,
        )
        return res.evaluator_revision ?? null
    }

    /**
     * Commit a new evaluator revision.
     */
    async commitRevision(revision: EvaluatorRevisionCommit): Promise<EvaluatorRevisionResponse> {
        const body: EvaluatorRevisionCommitRequest = {
            evaluator_revision_commit: revision,
        }
        return this.client.post<EvaluatorRevisionResponse>("/evaluators/revisions/commit", body)
    }

    /**
     * Find an evaluator by slug.
     */
    async findBySlug(slug: string): Promise<SimpleEvaluator | null> {
        const res = await this.query({refs: [{slug}]})
        return res.evaluators[0] ?? null
    }

    // ─── Catalog Templates ───────────────────────────────────────────────────

    /**
     * List available evaluator templates from the catalog.
     *
     * GET /preview/evaluators/catalog/templates/
     */
    async listTemplates(options?: {
        includeArchived?: boolean
    }): Promise<EvaluatorCatalogTemplate[]> {
        const res = await this.client.get<EvaluatorCatalogTemplatesResponse>(
            "/evaluators/catalog/templates/",
            {
                params: options?.includeArchived ? {include_archived: "true"} : undefined,
            },
        )
        return res.templates
    }

    /**
     * Get a single evaluator template by key.
     *
     * GET /preview/evaluators/catalog/templates/:key
     */
    async getTemplate(key: string): Promise<EvaluatorCatalogTemplate | null> {
        const res = await this.client.get<EvaluatorCatalogTemplateResponse>(
            `/evaluators/catalog/templates/${key}`,
        )
        return res.template ?? null
    }

    /**
     * List presets for an evaluator template.
     * Presets are pre-configured evaluator variants (e.g., "helpfulness" for AI critique).
     *
     * GET /preview/evaluators/catalog/templates/:key/presets/
     */
    async listPresets(templateKey: string): Promise<EvaluatorCatalogPreset[]> {
        const res = await this.client.get<EvaluatorCatalogPresetsResponse>(
            `/evaluators/catalog/templates/${templateKey}/presets/`,
        )
        return res.presets
    }

    // ─── Simple evaluator lifecycle ──────────────────────────────────────────

    /** Soft-delete (archive) a simple evaluator. */
    async archive(evaluatorId: string): Promise<SimpleEvaluatorResponse> {
        return this.client.post<SimpleEvaluatorResponse>(
            `/simple/evaluators/${evaluatorId}/archive`,
        )
    }

    /** Restore an archived simple evaluator. */
    async unarchive(evaluatorId: string): Promise<SimpleEvaluatorResponse> {
        return this.client.post<SimpleEvaluatorResponse>(
            `/simple/evaluators/${evaluatorId}/unarchive`,
        )
    }

    /**
     * Move a simple evaluator to a different project.
     *
     * The request body shape is loose pending the DTO drift audit. Typical
     * payload includes the destination project reference.
     */
    async transfer(
        evaluatorId: string,
        request: Record<string, unknown>,
    ): Promise<SimpleEvaluatorResponse> {
        return this.client.post<SimpleEvaluatorResponse>(
            `/simple/evaluators/${evaluatorId}/transfer`,
            request,
        )
    }

    // ─── Evaluator revisions (lifecycle + history) ───────────────────────────

    /** Fetch a single evaluator revision by ID. */
    async getRevision(revisionId: string): Promise<EvaluatorRevisionResponse> {
        return this.client.get<EvaluatorRevisionResponse>(`/evaluators/revisions/${revisionId}`)
    }

    /** Soft-delete (archive) an evaluator revision. */
    async archiveRevision(revisionId: string): Promise<EvaluatorRevisionResponse> {
        return this.client.post<EvaluatorRevisionResponse>(
            `/evaluators/revisions/${revisionId}/archive`,
        )
    }

    /** Restore an archived evaluator revision. */
    async unarchiveRevision(revisionId: string): Promise<EvaluatorRevisionResponse> {
        return this.client.post<EvaluatorRevisionResponse>(
            `/evaluators/revisions/${revisionId}/unarchive`,
        )
    }

    /**
     * Get the revision history (git-style log) for an evaluator.
     * Body shape is loose; typical payload includes evaluator/variant refs.
     */
    async logRevisions(request: Record<string, unknown>): Promise<EvaluatorRevisionsResponse> {
        return this.client.post<EvaluatorRevisionsResponse>("/evaluators/revisions/log", request)
    }

    /** Query evaluator revisions with filters. */
    async queryRevisions(options?: {
        refs?: Reference[]
        includeArchived?: boolean
        windowing?: Windowing
    }): Promise<EvaluatorRevisionsResponse> {
        const body = {
            evaluator_revision_refs: options?.refs,
            include_archived: options?.includeArchived,
            windowing: options?.windowing,
        }
        return this.client.post<EvaluatorRevisionsResponse>("/evaluators/revisions/query", body)
    }

    // ─── Evaluator variants ──────────────────────────────────────────────────

    /** Create a new evaluator variant. Body shape is loose pending DTO audit. */
    async createVariant(request: Record<string, unknown>): Promise<EvaluatorVariantResponse> {
        return this.client.post<EvaluatorVariantResponse>("/evaluators/variants/", request)
    }

    /** Fetch a single evaluator variant by ID. */
    async getVariant(variantId: string): Promise<EvaluatorVariantResponse> {
        return this.client.get<EvaluatorVariantResponse>(`/evaluators/variants/${variantId}`)
    }

    /** Soft-delete (archive) an evaluator variant. */
    async archiveVariant(variantId: string): Promise<EvaluatorVariantResponse> {
        return this.client.post<EvaluatorVariantResponse>(
            `/evaluators/variants/${variantId}/archive`,
        )
    }

    /** Restore an archived evaluator variant. */
    async unarchiveVariant(variantId: string): Promise<EvaluatorVariantResponse> {
        return this.client.post<EvaluatorVariantResponse>(
            `/evaluators/variants/${variantId}/unarchive`,
        )
    }

    /**
     * Fork an existing evaluator variant.
     * Body shape is loose; typical payload includes the source variant ref
     * and a new slug/name for the fork.
     */
    async forkVariant(request: Record<string, unknown>): Promise<EvaluatorVariantResponse> {
        return this.client.post<EvaluatorVariantResponse>("/evaluators/variants/fork", request)
    }

    /** Query evaluator variants with filters. */
    async queryVariants(options?: {
        refs?: Reference[]
        includeArchived?: boolean
        windowing?: Windowing
    }): Promise<EvaluatorVariantsResponse> {
        const body = {
            evaluator_variant_refs: options?.refs,
            include_archived: options?.includeArchived,
            windowing: options?.windowing,
        }
        return this.client.post<EvaluatorVariantsResponse>("/evaluators/variants/query", body)
    }
}
