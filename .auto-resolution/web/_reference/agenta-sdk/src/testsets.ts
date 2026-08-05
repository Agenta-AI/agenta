/**
 * Agenta TypeScript SDK — TestSets manager.
 *
 * Simple API for test set CRUD + revision commits.
 *
 * Endpoints:
 *   POST   /preview/simple/testsets/              → create
 *   GET    /preview/simple/testsets/:id            → get (testcases inline)
 *   PUT    /preview/simple/testsets/:id            → update (full replace)
 *   DELETE /preview/simple/testsets/:id            → delete
 *   POST   /preview/simple/testsets/query          → query
 *   POST   /preview/simple/testsets/:id/archive    → archive
 *   POST   /preview/simple/testsets/:id/unarchive  → unarchive
 *   POST   /preview/testsets/revisions/commit      → commitRevision (delta)
 */

import {schemas, validateBoundary, type SchemaOf} from "./.generated/index"
import type {AgentaClient} from "./client"
import type {
    TestSet,
    SimpleTestSetQuery,
    SimpleTestSetCreateRequest,
    SimpleTestSetEditRequest,
    SimpleTestSetQueryRequest,
    SimpleTestSetResponse,
    SimpleTestSetsResponse,
    TestSetRevisionCommitRequest,
    TestSetRevisionResponse,
    Reference,
    Windowing,
} from "./types"

export class TestSets {
    constructor(private readonly client: AgentaClient) {}

    /**
     * Create a new test set with inline testcases.
     *
     * Each testcase is `{ data: Record<string, unknown> }` — freeform columns.
     * IDs are auto-assigned by the server.
     *
     * @param options.testcases - Array of raw data objects (wrapped in `{ data }` automatically)
     */
    async create(options: {
        slug: string
        name: string
        description?: string
        testcases: Record<string, unknown>[]
    }): Promise<TestSet> {
        const body: SimpleTestSetCreateRequest = {
            testset: {
                slug: options.slug,
                name: options.name,
                description: options.description,
                data: {
                    testcases: options.testcases.map((tc) => ({data: tc})),
                },
            },
        }
        const res = await this.client.post<SimpleTestSetResponse>("/simple/testsets/", body)
        return res.testset!
    }

    /**
     * Get a test set by ID. Returns testcases inline in `data.testcases`.
     */
    async get(testsetId: string): Promise<TestSet> {
        const res = await this.client.get<SimpleTestSetResponse>(`/simple/testsets/${testsetId}`)
        return res.testset!
    }

    /**
     * Query test sets with optional filtering and pagination.
     */
    async query(options?: {
        filter?: SimpleTestSetQuery
        refs?: Reference[]
        includeArchived?: boolean
        windowing?: Windowing
    }): Promise<SimpleTestSetsResponse> {
        const body: SimpleTestSetQueryRequest = {
            testset: options?.filter,
            testset_refs: options?.refs,
            include_archived: options?.includeArchived,
            windowing: options?.windowing,
        }
        return this.client.post<SimpleTestSetsResponse>("/simple/testsets/query", body)
    }

    /**
     * List all test sets (no filter, no pagination).
     */
    async list(): Promise<TestSet[]> {
        const res = await this.query()
        return res.testsets
    }

    /**
     * Update a test set. Replaces testcases entirely (full replacement, not merge).
     * For incremental adds, use commitRevision().
     *
     * @param options.testcases - If provided, replaces all testcases. Raw data objects.
     */
    async update(
        testsetId: string,
        options: {
            name?: string
            description?: string
            testcases?: Record<string, unknown>[]
        },
    ): Promise<TestSet> {
        const body: SimpleTestSetEditRequest = {
            testset: {
                id: testsetId,
                ...(options.name != null ? {name: options.name} : {}),
                ...(options.description != null ? {description: options.description} : {}),
                ...(options.testcases
                    ? {
                          data: {
                              testcases: options.testcases.map((tc) => ({data: tc})),
                          },
                      }
                    : {}),
            },
        }
        const res = await this.client.put<SimpleTestSetResponse>(
            `/simple/testsets/${testsetId}`,
            body,
        )
        return res.testset!
    }

    /**
     * Delete a test set.
     */
    async delete(testsetId: string): Promise<void> {
        await this.client.delete(`/simple/testsets/${testsetId}`)
    }

    /**
     * Archive (soft delete) a test set.
     */
    async archive(testsetId: string): Promise<SimpleTestSetResponse> {
        return this.client.post<SimpleTestSetResponse>(`/simple/testsets/${testsetId}/archive`)
    }

    /**
     * Unarchive (restore) a test set.
     */
    async unarchive(testsetId: string): Promise<SimpleTestSetResponse> {
        return this.client.post<SimpleTestSetResponse>(`/simple/testsets/${testsetId}/unarchive`)
    }

    /**
     * Commit a new revision with testcases (supports delta updates).
     * Unlike update(), this creates a new revision without replacing the previous one.
     */
    async commitRevision(options: {
        testsetId: string
        testsetVariantId?: string
        testcases: Record<string, unknown>[]
        message?: string
    }): Promise<TestSetRevisionResponse> {
        const body: TestSetRevisionCommitRequest = {
            testset_revision: {
                testset_id: options.testsetId,
                testset_variant_id: options.testsetVariantId,
                data: {
                    testcases: options.testcases.map((tc) => ({data: tc})),
                },
                message: options.message,
            },
        }
        return this.client.post<TestSetRevisionResponse>("/testsets/revisions/commit", body)
    }

    /**
     * Query test set revisions with filtering and pagination.
     */
    async queryRevisions(options?: {
        testsetRefs?: Reference[]
        testsetVariantRefs?: Reference[]
        includeTestcases?: boolean
        windowing?: Windowing
    }): Promise<SchemaOf<"TestsetRevisionsResponse">> {
        const body = {
            testset_refs: options?.testsetRefs,
            testset_variant_refs: options?.testsetVariantRefs,
            include_testcases: options?.includeTestcases,
            windowing: options?.windowing,
        }
        const raw = await this.client.post("/testsets/revisions/query", body)
        return validateBoundary(raw, schemas.TestsetRevisionsResponse, "TestSets.queryRevisions")
    }

    /**
     * Get a single test set revision by ID.
     */
    async getRevision(
        revisionId: string,
        options?: {includeTestcases?: boolean},
    ): Promise<SchemaOf<"TestsetRevisionResponse">> {
        const params: Record<string, string> = {}
        if (options?.includeTestcases != null) {
            params.include_testcases = String(options.includeTestcases)
        }
        const raw = await this.client.get(`/testsets/revisions/${revisionId}`, {params})
        return validateBoundary(raw, schemas.TestsetRevisionResponse, "TestSets.getRevision")
    }

    /**
     * Query test sets (raw passthrough). Unlike `query()`, returns the raw response.
     */
    async queryTestsets(
        body?: Record<string, unknown>,
    ): Promise<SchemaOf<"SimpleTestsetsResponse">> {
        const raw = await this.client.post("/simple/testsets/query", body)
        return validateBoundary(raw, schemas.SimpleTestsetsResponse, "TestSets.queryTestsets")
    }

    /**
     * Get a test set by ID (raw response).
     */
    async getTestset(testsetId: string): Promise<SchemaOf<"SimpleTestsetResponse">> {
        const raw = await this.client.get(`/simple/testsets/${testsetId}`)
        return validateBoundary(raw, schemas.SimpleTestsetResponse, "TestSets.getTestset")
    }

    /**
     * Get a test set variant by ID.
     */
    async getVariant(variantId: string): Promise<SchemaOf<"TestsetVariantResponse">> {
        const raw = await this.client.get(`/simple/testsets/variants/${variantId}`)
        return validateBoundary(raw, schemas.TestsetVariantResponse, "TestSets.getVariant")
    }

    /**
     * Archive a test set revision.
     */
    async archiveRevision(revisionId: string): Promise<SchemaOf<"TestsetRevisionResponse">> {
        const raw = await this.client.post(`/testsets/revisions/${revisionId}/archive`)
        return validateBoundary(raw, schemas.TestsetRevisionResponse, "TestSets.archiveRevision")
    }

    /**
     * Restore an archived test set revision.
     */
    async unarchiveRevision(revisionId: string): Promise<SchemaOf<"TestsetRevisionResponse">> {
        const raw = await this.client.post(`/testsets/revisions/${revisionId}/unarchive`)
        return validateBoundary(raw, schemas.TestsetRevisionResponse, "TestSets.unarchiveRevision")
    }

    /**
     * Get the revision history (git-style log) for a test set.
     * Body shape is loose pending DTO drift audit.
     */
    async logRevisions(
        request: Record<string, unknown>,
    ): Promise<SchemaOf<"TestsetRevisionsResponse">> {
        const raw = await this.client.post("/testsets/revisions/log", request)
        return validateBoundary(raw, schemas.TestsetRevisionsResponse, "TestSets.logRevisions")
    }

    /**
     * Retrieve a test set revision by reference.
     * Used to fetch a revision via testset/variant/revision/environment refs.
     */
    async retrieveRevision(
        request: Record<string, unknown>,
    ): Promise<SchemaOf<"TestsetRevisionResponse">> {
        const raw = await this.client.post("/testsets/revisions/retrieve", request)
        return validateBoundary(raw, schemas.TestsetRevisionResponse, "TestSets.retrieveRevision")
    }

    /**
     * Move a simple testset to a different project.
     */
    async transfer(
        testsetId: string,
        request: Record<string, unknown>,
    ): Promise<SchemaOf<"TestsetResponse">> {
        const raw = await this.client.post(`/simple/testsets/${testsetId}/transfer`, request)
        return validateBoundary(raw, schemas.TestsetResponse, "TestSets.transfer")
    }

    /**
     * Create a test set variant. Body shape is loose pending DTO audit.
     */
    async createVariant(
        request: Record<string, unknown>,
    ): Promise<SchemaOf<"TestsetVariantResponse">> {
        const raw = await this.client.post("/testsets/variants/", request)
        return validateBoundary(raw, schemas.TestsetVariantResponse, "TestSets.createVariant")
    }

    /**
     * Archive a test set variant.
     */
    async archiveVariant(variantId: string): Promise<SchemaOf<"TestsetVariantResponse">> {
        const raw = await this.client.post(`/testsets/variants/${variantId}/archive`)
        return validateBoundary(raw, schemas.TestsetVariantResponse, "TestSets.archiveVariant")
    }

    /**
     * Restore an archived test set variant.
     */
    async unarchiveVariant(variantId: string): Promise<SchemaOf<"TestsetVariantResponse">> {
        const raw = await this.client.post(`/testsets/variants/${variantId}/unarchive`)
        return validateBoundary(raw, schemas.TestsetVariantResponse, "TestSets.unarchiveVariant")
    }

    /**
     * Query test set variants with filters.
     */
    async queryVariants(options?: {
        refs?: Reference[]
        includeArchived?: boolean
        windowing?: Windowing
    }): Promise<SchemaOf<"TestsetVariantsResponse">> {
        const body = {
            testset_variant_refs: options?.refs,
            include_archived: options?.includeArchived,
            windowing: options?.windowing,
        }
        const raw = await this.client.post("/testsets/variants/query", body)
        return validateBoundary(raw, schemas.TestsetVariantsResponse, "TestSets.queryVariants")
    }

    /**
     * Upload a file to create a new test set.
     * Returns the raw Response object.
     */
    async upload(options: {formData: FormData}): Promise<Response> {
        return this.client.requestRaw("POST", "/simple/testsets/upload", {body: options.formData})
    }

    /**
     * Upload a file to create a new revision for an existing test set.
     * Returns the raw Response object.
     */
    async uploadRevision(testsetId: string, options: {formData: FormData}): Promise<Response> {
        return this.client.requestRaw("POST", `/simple/testsets/${testsetId}/upload`, {
            body: options.formData,
        })
    }

    /**
     * Download a test set as a file.
     * Returns a Blob from the raw Response.
     */
    async download(testsetId: string, fileType: string): Promise<Blob> {
        const res = await this.client.requestRaw("POST", `/simple/testsets/${testsetId}/download`, {
            body: JSON.stringify({file_type: fileType}),
            headers: {"Content-Type": "application/json"},
        })
        return res.blob()
    }

    /**
     * Download a test set revision as a file.
     * Returns a Blob from the raw Response.
     */
    async downloadRevision(revisionId: string, fileType: string): Promise<Blob> {
        const res = await this.client.requestRaw(
            "POST",
            `/testsets/revisions/${revisionId}/download`,
            {
                body: JSON.stringify({file_type: fileType}),
                headers: {"Content-Type": "application/json"},
            },
        )
        return res.blob()
    }

    /**
     * Find a test set by slug.
     */
    async findBySlug(slug: string): Promise<TestSet | null> {
        const res = await this.query({refs: [{slug}]})
        return res.testsets[0] ?? null
    }

    /**
     * Create a test set from trace IDs (client-side composition).
     *
     * Fetches each trace, applies the extractFields callback to extract testcase data,
     * and creates a new test set with the results.
     *
     * @param options.extractFields - Callback that receives trace data and returns testcase data
     */
    async createFromTraces(options: {
        slug: string
        name: string
        description?: string
        traceIds: string[]
        extractFields: (traceData: Record<string, unknown>) => Record<string, unknown>
        /** Pass the Tracing manager from the same Agenta instance. */
        getTrace: (traceId: string) => Promise<Record<string, unknown>>
    }): Promise<TestSet> {
        const testcases: Record<string, unknown>[] = []

        for (const traceId of options.traceIds) {
            const trace = await options.getTrace(traceId)
            const fields = options.extractFields(trace)
            testcases.push(fields)
        }

        return this.create({
            slug: options.slug,
            name: options.name,
            description: options.description,
            testcases,
        })
    }
}
