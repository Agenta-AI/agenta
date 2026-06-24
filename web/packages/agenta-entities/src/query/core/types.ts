/**
 * Query entity — core types.
 *
 * Queries are project-scoped, git-style saved trace filters
 * (Query artifact → QueryVariant → QueryRevision). QueryRevisionData holds the
 * filtering + windowing that a live evaluation uses to match traces.
 *
 * T1 (create-slice) only needs the create/retrieve shapes. The full read-path
 * schemas (SimpleQuery list rows, filtering round-trip) land in Phase 2.
 */

import type {AgentaApi} from "@agentaai/api-client"

export type SimpleQueryCreate = AgentaApi.SimpleQueryCreate
export type SimpleQueryEdit = AgentaApi.SimpleQueryEdit
export type QueryRevisionDataInput = AgentaApi.QueryRevisionDataInput
export type SimpleQuery = AgentaApi.SimpleQuery
export type QueryRevision = AgentaApi.QueryRevision

/** Payload for creating a SimpleQuery (name + slug + filtering/windowing data). */
export interface CreateSimpleQueryParams {
    projectId: string
    query: SimpleQueryCreate
}

/** Result of creating a SimpleQuery: the artifact id plus its head variant/revision. */
export interface CreateSimpleQueryResult {
    queryId: string
    variantId: string | null
    revisionId: string
}
