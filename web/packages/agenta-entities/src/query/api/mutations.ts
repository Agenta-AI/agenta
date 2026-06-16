/**
 * Query mutations (Fern-backed, pure — no Jotai).
 *
 * `createSimpleQuery` is the single create path. The live-eval drawer is
 * repointed at this (T1) so a query created during live-eval setup shares the
 * entity cache and shows up in the Query Registry (callers fire
 * `invalidateQueryCache` after a successful create).
 */

import {getAgentaSdkClient} from "@agenta/sdk"
import {getAgentaApiUrl} from "@agenta/shared/api"
import type {AgentaApi} from "@agentaai/api-client"
import {v4 as uuidv4} from "uuid"

import type {
    CreateSimpleQueryParams,
    CreateSimpleQueryResult,
    QueryRevisionDataInput,
    SimpleQueryEdit,
} from "../core/types"

import {retrieveQueryRevision} from "./api"

/**
 * The backend requires a non-null, project-unique artifact slug — without it
 * `create_query` returns None and the create silently no-ops ({count: 0}). Derive
 * a stable slug from the name plus a short random suffix.
 */
function makeQuerySlug(name?: string | null): string {
    const base = (name ?? "query")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40)
    return `${base || "query"}-${uuidv4().slice(0, 8)}`
}

export async function createSimpleQuery({
    projectId,
    query,
}: CreateSimpleQueryParams): Promise<CreateSimpleQueryResult> {
    const client = getAgentaSdkClient({host: getAgentaApiUrl()})
    const response = await client.queries.createSimpleQuery(
        {query: {...query, slug: query.slug || makeQuerySlug(query.name)}},
        {queryParams: {project_id: projectId}},
    )

    const created = response.query
    if (!created?.id) {
        throw new Error("Unable to create query.")
    }

    const variantId = created.variant_id ?? null
    let revisionId = created.revision_id ?? null

    // Fallback preserves the live-eval drawer's original two-call behavior when
    // the create response omits the head revision id.
    if (!revisionId) {
        const revision = await retrieveQueryRevision({projectId, queryRef: {id: created.id}})
        revisionId = revision?.id ?? null
    }

    if (!revisionId) {
        throw new Error("Unable to resolve query revision after create.")
    }

    return {queryId: created.id, variantId, revisionId}
}

export interface EditSimpleQueryParams {
    projectId: string
    queryId: string
    query: SimpleQueryEdit
}

/** Edit a query — commits a new head revision with the updated name/filter/window. */
export async function editSimpleQuery({
    projectId,
    queryId,
    query,
}: EditSimpleQueryParams): Promise<void> {
    const client = getAgentaSdkClient({host: getAgentaApiUrl()})
    await client.queries.editSimpleQuery(
        {query_id: queryId, query},
        {queryParams: {project_id: projectId}},
    )
}

export interface CommitQueryRevisionParams {
    projectId: string
    /** The query's head variant to commit a new revision onto. */
    variantId: string
    data: QueryRevisionDataInput
    name?: string
    /** Git-style commit message attached to the new revision. */
    message?: string
}

/**
 * Commit a new revision to a query's variant with an optional commit message —
 * the git-style update path (`/queries/revisions/commit`). Unlike
 * `editSimpleQuery`, this carries a `message`, so it backs the registry's commit
 * modal. Simple queries are single-variant, so the variant id comes from the
 * head revision.
 */
export async function commitQueryRevision({
    projectId,
    variantId,
    data,
    name,
    message,
}: CommitQueryRevisionParams): Promise<void> {
    const client = getAgentaSdkClient({host: getAgentaApiUrl()})
    const queryRevision: AgentaApi.QueryRevisionCommit = {
        variant_id: variantId,
        data,
        ...(name != null ? {name} : {}),
        ...(message ? {message} : {}),
    }
    await client.queries.commitQueryRevision(
        {query_revision: queryRevision},
        {queryParams: {project_id: projectId}},
    )
}

export interface ArchiveSimpleQueryParams {
    projectId: string
    queryId: string
}

/** Archive (soft-delete) a query. Reversible via unarchive; safe-archive confirm
 *  lives in the UI since the backend exposes no reverse-reference lookup. */
export async function archiveSimpleQuery({
    projectId,
    queryId,
}: ArchiveSimpleQueryParams): Promise<void> {
    const client = getAgentaSdkClient({host: getAgentaApiUrl()})
    await client.queries.archiveSimpleQuery(
        {query_id: queryId},
        {queryParams: {project_id: projectId}},
    )
}

export interface ArchiveQueryRevisionParams {
    projectId: string
    revisionId: string
}

/** Archive (soft-delete) a single query revision — distinct from archiving the
 *  whole query artifact. Used by the registry's per-version archive. */
export async function archiveQueryRevision({
    projectId,
    revisionId,
}: ArchiveQueryRevisionParams): Promise<void> {
    const client = getAgentaSdkClient({host: getAgentaApiUrl()})
    await client.queries.archiveQueryRevision(
        {query_revision_id: revisionId},
        {queryParams: {project_id: projectId}},
    )
}

export interface UnarchiveSimpleQueryParams {
    projectId: string
    queryId: string
}

/** Restore a previously archived query (clears the soft-delete marker). */
export async function unarchiveSimpleQuery({
    projectId,
    queryId,
}: UnarchiveSimpleQueryParams): Promise<void> {
    const client = getAgentaSdkClient({host: getAgentaApiUrl()})
    await client.queries.unarchiveSimpleQuery(
        {query_id: queryId},
        {queryParams: {project_id: projectId}},
    )
}
