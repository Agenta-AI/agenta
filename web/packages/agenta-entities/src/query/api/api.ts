/**
 * Query API functions (Fern-backed, pure — no Jotai).
 *
 * Queries are project-scoped; every call passes project_id via queryParams.
 */

import {getAgentaSdkClient} from "@agenta/sdk"
import {getAgentaApiUrl} from "@agenta/shared/api"
import type {AgentaApi} from "@agentaai/api-client"

import {transformTracesResponseToTree, type TraceSpanNode} from "../../trace"

export interface RetrieveQueryRevisionParams {
    projectId: string
    queryRef?: AgentaApi.Reference
    queryVariantRef?: AgentaApi.Reference
    queryRevisionRef?: AgentaApi.Reference
    /** Execute the filter and return matching trace ids (used by the drawer match-count). */
    includeTraceIds?: boolean
}

export interface CountMatchingTracesParams {
    projectId: string
    /** The in-progress query filtering (structurally the tracing FilteringInput). */
    filtering?: unknown
    abortSignal?: AbortSignal
}

/**
 * Count traces matching a filter, for the drawer's live match-count (design D3).
 * Executes the filter against the trace store with `limit: 1` and reads the
 * window count — no trace payloads are materialized.
 */
export async function countMatchingTraces({
    projectId,
    filtering,
    abortSignal,
}: CountMatchingTracesParams): Promise<number | null> {
    // Match the trace entity's accessor (getTracesClient = getAgentaSdkClient()
    // with no host override). Passing `{host: getAgentaApiUrl()}` here points the
    // traces resource at a cross-origin host that rejects the session cookie (401).
    const client = getAgentaSdkClient()
    const response = await client.traces.queryTraces(
        {
            ...(filtering ? {filtering: filtering as AgentaApi.FilteringInput} : {}),
            windowing: {limit: 1},
        },
        {queryParams: {project_id: projectId}, abortSignal},
    )
    return response.count ?? null
}

export interface QueryMatchingTracesParams {
    projectId: string
    filtering?: unknown
    limit?: number
    abortSignal?: AbortSignal
}

/**
 * Fetch the traces matching a filter, as a tree, for the drawer's "matching
 * traces" preview. Reuses the trace resource (`queryTraces`) + the shared
 * `transformTracesResponseToTree` adapter so the observability columns render it.
 */
export async function queryMatchingTraces({
    projectId,
    filtering,
    limit = 50,
}: QueryMatchingTracesParams): Promise<TraceSpanNode[]> {
    const client = getAgentaSdkClient()
    const response = await client.traces.queryTraces(
        {
            ...(filtering ? {filtering: filtering as AgentaApi.FilteringInput} : {}),
            windowing: {limit, order: "descending"},
        },
        {queryParams: {project_id: projectId}},
    )
    return transformTracesResponseToTree(response as never)
}

export interface QuerySimpleQueriesParams {
    projectId: string
    windowing?: AgentaApi.Windowing
    /**
     * Include soft-deleted (archived) queries. The backend returns both active and
     * archived rows when set; the Archived tab filters to `deleted_at != null`.
     */
    includeArchived?: boolean
}

/**
 * List project-scoped SimpleQueries (flattened query + head-revision data),
 * cursor-paginated via windowing. Each row carries `data` (filtering/windowing),
 * `variant_id`, and `revision_id` inline — no per-row revision fetch needed.
 */
export async function querySimpleQueries({
    projectId,
    windowing,
    includeArchived,
}: QuerySimpleQueriesParams): Promise<AgentaApi.SimpleQueriesResponse> {
    const client = getAgentaSdkClient({host: getAgentaApiUrl()})
    return await client.queries.querySimpleQueries(
        {
            ...(windowing ? {windowing} : {}),
            ...(includeArchived ? {include_archived: true} : {}),
        },
        {queryParams: {project_id: projectId}},
    )
}

export interface QueryRevisionSummary {
    /** Owning query artifact id — lets a batched fetch be grouped per query. */
    queryId: string
    revisionId: string
    version: string | null
    filtering: unknown
    createdAt: string | null
    createdById: string | null
    message: string | null
    /** Soft-delete marker — set when the revision has been archived. */
    deletedAt: string | null
}

const toRevisionSummary = (revision: AgentaApi.QueryRevision): QueryRevisionSummary => ({
    queryId: revision.query_id ?? revision.artifact_id ?? "",
    revisionId: revision.id ?? "",
    version: revision.version ?? null,
    filtering: revision.data?.filtering ?? null,
    createdAt: revision.created_at ?? null,
    createdById: revision.created_by_id ?? null,
    message: revision.message ?? null,
    deletedAt: revision.deleted_at ?? null,
})

export interface QueryRevisionsByQueryParams {
    projectId: string
    queryId: string
    includeArchived?: boolean
}

/**
 * List the revision history of one query artifact (newest first). Queries by the
 * artifact ref (`query_refs`) — simple queries are single-variant, so this is the
 * full version history and needs no variant id.
 */
export async function queryQueryRevisions({
    projectId,
    queryId,
    includeArchived,
}: QueryRevisionsByQueryParams): Promise<QueryRevisionSummary[]> {
    return queryRevisionsForQueries({projectId, queryIds: [queryId], includeArchived})
}

export interface QueryRevisionsForQueriesParams {
    projectId: string
    queryIds: string[]
    limit?: number
    /** Include archived revisions so they can be shown (tagged) + restored. */
    includeArchived?: boolean
}

/**
 * Batched revision history for several query artifacts in one request (newest
 * first), grouped client-side by `queryId`. Used by the registry to surface each
 * query's head version + earlier-version rows without an N+1 per row.
 */
export async function queryRevisionsForQueries({
    projectId,
    queryIds,
    limit = 500,
    includeArchived,
}: QueryRevisionsForQueriesParams): Promise<QueryRevisionSummary[]> {
    if (!queryIds.length) return []
    const client = getAgentaSdkClient({host: getAgentaApiUrl()})
    const response = await client.queries.queryQueryRevisions(
        {
            query_refs: queryIds.map((id) => ({id})),
            ...(includeArchived ? {include_archived: true} : {}),
            windowing: {limit, order: "descending"},
        },
        {queryParams: {project_id: projectId}},
    )
    return (response.query_revisions ?? []).map(toRevisionSummary)
}

/**
 * Retrieve a query revision (latest by default). When no variant/revision ref is
 * given, returns the head revision of the query artifact.
 */
export async function retrieveQueryRevision(
    params: RetrieveQueryRevisionParams,
): Promise<AgentaApi.QueryRevision | null> {
    const {projectId, queryRef, queryVariantRef, queryRevisionRef, includeTraceIds} = params
    const client = getAgentaSdkClient({host: getAgentaApiUrl()})
    const response = await client.queries.retrieveQueryRevision(
        {
            ...(queryRef ? {query_ref: queryRef} : {}),
            ...(queryVariantRef ? {query_variant_ref: queryVariantRef} : {}),
            ...(queryRevisionRef ? {query_revision_ref: queryRevisionRef} : {}),
            ...(includeTraceIds ? {include_trace_ids: true} : {}),
        },
        {queryParams: {project_id: projectId}},
    )
    return response.query_revision ?? null
}
