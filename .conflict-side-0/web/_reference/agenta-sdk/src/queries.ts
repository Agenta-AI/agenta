/**
 * Agenta TypeScript SDK — Queries manager.
 *
 * Saved filter/query CRUD plus revisions and the simple-query lifecycle.
 *
 * Surface:
 *   Full queries:
 *     POST /preview/queries/                      → create
 *     POST /preview/queries/query                 → query
 *     GET  /preview/queries/:id                   → get
 *     PUT  /preview/queries/:id                   → update
 *     POST /preview/queries/:id/archive           → archive
 *     POST /preview/queries/:id/unarchive         → unarchive
 *
 *   Revisions:
 *     POST /preview/queries/revisions/retrieve    → retrieveRevision
 *     POST /preview/queries/revisions/commit      → commitRevision
 *     GET  /preview/queries/revisions/:id         → getRevision
 *     POST /preview/queries/revisions/:id/archive → archiveRevision
 *     POST /preview/queries/revisions/:id/unarchive → unarchiveRevision
 *     POST /preview/queries/revisions/log         → logRevisions
 *     POST /preview/queries/revisions/query       → queryRevisions
 *
 *   Simple queries (used by online evaluations for filter definitions):
 *     POST /preview/simple/queries/               → createSimple
 *     POST /preview/simple/queries/query          → querySimple
 *     GET  /preview/simple/queries/:id            → getSimple
 *     POST /preview/simple/queries/:id/archive    → archiveSimple
 *     POST /preview/simple/queries/:id/unarchive  → unarchiveSimple
 */

import type {AgentaClient} from "./client"
import type {
    QueryCreateRequest,
    QueryEditRequest,
    QueryResponse,
    QueriesResponse,
    SimpleQueryCreateRequest,
    SimpleQueryResponse,
    QueryRevisionRetrieveRequest,
    QueryRevisionResponse,
    Reference,
    Windowing,
} from "./types"

/** Multi-revision query response. Loose pending DTO drift audit. */
export interface QueryRevisionsResponse {
    count: number
    query_revisions: unknown[]
}

/** Multi-simple-query response. Loose pending DTO drift audit. */
export interface SimpleQueriesResponse {
    count: number
    queries: unknown[]
}

export class Queries {
    constructor(private readonly client: AgentaClient) {}

    async create(request: QueryCreateRequest): Promise<QueryResponse> {
        return this.client.post<QueryResponse>("/queries/", request)
    }

    async get(queryId: string): Promise<QueryResponse> {
        return this.client.get<QueryResponse>(`/queries/${queryId}`)
    }

    async update(queryId: string, request: QueryEditRequest): Promise<QueryResponse> {
        return this.client.put<QueryResponse>(`/queries/${queryId}`, request)
    }

    async archive(queryId: string): Promise<void> {
        await this.client.post(`/queries/${queryId}/archive`)
    }

    async unarchive(queryId: string): Promise<void> {
        await this.client.post(`/queries/${queryId}/unarchive`)
    }

    async query(request?: Record<string, unknown>): Promise<QueriesResponse> {
        return this.client.post<QueriesResponse>("/queries/query", request ?? {})
    }

    // ─── Revisions ───────────────────────────────────────────────────────────

    /**
     * Retrieve a query revision by reference.
     *
     * POST /preview/queries/revisions/retrieve
     */
    async retrieveRevision(request: QueryRevisionRetrieveRequest): Promise<QueryRevisionResponse> {
        return this.client.post<QueryRevisionResponse>("/queries/revisions/retrieve", request)
    }

    /** Commit a new query revision. Body shape is loose pending DTO audit. */
    async commitRevision(request: Record<string, unknown>): Promise<QueryRevisionResponse> {
        return this.client.post<QueryRevisionResponse>("/queries/revisions/commit", request)
    }

    /** Fetch a single query revision by ID. */
    async getRevision(revisionId: string): Promise<QueryRevisionResponse> {
        return this.client.get<QueryRevisionResponse>(`/queries/revisions/${revisionId}`)
    }

    /** Archive a query revision. */
    async archiveRevision(revisionId: string): Promise<QueryRevisionResponse> {
        return this.client.post<QueryRevisionResponse>(`/queries/revisions/${revisionId}/archive`)
    }

    /** Unarchive a query revision. */
    async unarchiveRevision(revisionId: string): Promise<QueryRevisionResponse> {
        return this.client.post<QueryRevisionResponse>(`/queries/revisions/${revisionId}/unarchive`)
    }

    /** Get the revision history for a query. */
    async logRevisions(request: Record<string, unknown>): Promise<QueryRevisionsResponse> {
        return this.client.post<QueryRevisionsResponse>("/queries/revisions/log", request)
    }

    /** Query query revisions with filters. */
    async queryRevisions(options?: {
        refs?: Reference[]
        includeArchived?: boolean
        windowing?: Windowing
    }): Promise<QueryRevisionsResponse> {
        const body = {
            query_revision_refs: options?.refs,
            include_archived: options?.includeArchived,
            windowing: options?.windowing,
        }
        return this.client.post<QueryRevisionsResponse>("/queries/revisions/query", body)
    }

    // ─── Simple queries ──────────────────────────────────────────────────────

    /**
     * Create a simple query (used by online evaluations for filter definitions).
     *
     * POST /preview/simple/queries/
     */
    async createSimple(request: SimpleQueryCreateRequest): Promise<SimpleQueryResponse> {
        return this.client.post<SimpleQueryResponse>("/simple/queries/", request)
    }

    /** Fetch a simple query by ID. */
    async getSimple(queryId: string): Promise<SimpleQueryResponse> {
        return this.client.get<SimpleQueryResponse>(`/simple/queries/${queryId}`)
    }

    /** Archive a simple query. */
    async archiveSimple(queryId: string): Promise<SimpleQueryResponse> {
        return this.client.post<SimpleQueryResponse>(`/simple/queries/${queryId}/archive`)
    }

    /** Unarchive a simple query. */
    async unarchiveSimple(queryId: string): Promise<SimpleQueryResponse> {
        return this.client.post<SimpleQueryResponse>(`/simple/queries/${queryId}/unarchive`)
    }

    /** Query simple queries with filters. */
    async querySimple(options?: {
        refs?: Reference[]
        includeArchived?: boolean
        windowing?: Windowing
    }): Promise<SimpleQueriesResponse> {
        const body = {
            query_refs: options?.refs,
            include_archived: options?.includeArchived,
            windowing: options?.windowing,
        }
        return this.client.post<SimpleQueriesResponse>("/simple/queries/query", body)
    }
}
