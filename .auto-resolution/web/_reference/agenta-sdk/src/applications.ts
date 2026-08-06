/**
 * Agenta TypeScript SDK — Applications manager.
 *
 * Simple API for CRUD on applications (prompt apps, chat apps, etc.) plus
 * lifecycle ops on individual variants.
 *
 * Application-level endpoints:
 *   POST   /preview/simple/applications/query          → query
 *   POST   /preview/simple/applications/               → create
 *   GET    /preview/simple/applications/:id             → get
 *   PUT    /preview/simple/applications/:id             → update
 *   POST   /preview/simple/applications/:id/archive     → archive
 *   POST   /preview/simple/applications/:id/unarchive   → unarchive
 *
 * Variant-level endpoints:
 *   POST   /preview/applications/variants/:id/archive   → archiveVariant
 *   POST   /preview/applications/variants/:id/unarchive → unarchiveVariant
 *
 * The variant ops mirror Python's `VariantManager.delete()` /
 * `VariantManager.adelete()` (`sdk/agenta/sdk/managers/variant.py:95-124`),
 * which despite the name perform a soft-delete via the archive endpoint.
 */

import type {AgentaClient} from "./client"
import type {
    ApplicationVariantResponse,
    SimpleApplication,
    SimpleApplicationCreate,
    SimpleApplicationEdit,
    SimpleApplicationQuery,
    SimpleApplicationCreateRequest,
    SimpleApplicationEditRequest,
    SimpleApplicationQueryRequest,
    SimpleApplicationResponse,
    SimpleApplicationsResponse,
    Reference,
    Windowing,
} from "./types"

export class Applications {
    constructor(private readonly client: AgentaClient) {}

    /**
     * Query applications with optional filtering and pagination.
     */
    async query(options?: {
        filter?: SimpleApplicationQuery
        refs?: Reference[]
        includeArchived?: boolean
        windowing?: Windowing
    }): Promise<SimpleApplicationsResponse> {
        const body: SimpleApplicationQueryRequest = {
            application: options?.filter,
            application_refs: options?.refs,
            include_archived: options?.includeArchived,
            windowing: options?.windowing,
        }
        return this.client.post<SimpleApplicationsResponse>("/simple/applications/query", body)
    }

    /**
     * Fetch all applications (no filter, no pagination).
     * Convenience wrapper around query().
     */
    async list(): Promise<SimpleApplication[]> {
        const res = await this.query()
        return res.applications
    }

    /**
     * Get a single application by ID.
     */
    async get(applicationId: string): Promise<SimpleApplication | null> {
        const res = await this.client.get<SimpleApplicationResponse>(
            `/simple/applications/${applicationId}`,
        )
        return res.application ?? null
    }

    /**
     * Create a new application.
     */
    async create(application: SimpleApplicationCreate): Promise<SimpleApplicationResponse> {
        const body: SimpleApplicationCreateRequest = {application}
        return this.client.post<SimpleApplicationResponse>("/simple/applications/", body)
    }

    /**
     * Update an existing application.
     * Can update name, description, flags, metadata, and data.
     */
    async update(application: SimpleApplicationEdit): Promise<SimpleApplicationResponse> {
        const body: SimpleApplicationEditRequest = {application}
        return this.client.put<SimpleApplicationResponse>(
            `/simple/applications/${application.id}`,
            body,
        )
    }

    /**
     * Soft-delete (archive) an application.
     */
    async archive(applicationId: string): Promise<SimpleApplicationResponse> {
        return this.client.post<SimpleApplicationResponse>(
            `/simple/applications/${applicationId}/archive`,
        )
    }

    /**
     * Restore an archived application.
     */
    async unarchive(applicationId: string): Promise<SimpleApplicationResponse> {
        return this.client.post<SimpleApplicationResponse>(
            `/simple/applications/${applicationId}/unarchive`,
        )
    }

    /**
     * Soft-delete (archive) a single application variant.
     *
     * Mirrors Python's `VariantManager.delete()`. Hits
     * `POST /preview/applications/variants/{id}/archive`. Use this when you
     * want to retire one variant of an application without affecting the
     * application or its other variants.
     */
    async archiveVariant(variantId: string): Promise<ApplicationVariantResponse> {
        return this.client.post<ApplicationVariantResponse>(
            `/applications/variants/${variantId}/archive`,
        )
    }

    /**
     * Restore an archived application variant.
     *
     * Hits `POST /preview/applications/variants/{id}/unarchive`. The inverse
     * of `archiveVariant`.
     */
    async unarchiveVariant(variantId: string): Promise<ApplicationVariantResponse> {
        return this.client.post<ApplicationVariantResponse>(
            `/applications/variants/${variantId}/unarchive`,
        )
    }

    /**
     * Find an application by slug.
     * Returns null if not found.
     *
     * Note: Agenta's query API doesn't support server-side slug filtering
     * via refs, so we fetch all apps and filter client-side.
     */
    async findBySlug(slug: string): Promise<SimpleApplication | null> {
        const apps = await this.list()
        return apps.find((a) => a.slug === slug) ?? null
    }
}
