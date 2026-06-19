/**
 * Query entity — server-state atoms + cache invalidation.
 *
 * Queries are git-style entities (Query artifact → QueryVariant → QueryRevision).
 * The molecule (see ./molecule) tracks committed-vs-draft state for a single
 * query's head revision; these atoms are its server-data source and its draft
 * storage.
 */

import {projectIdAtom} from "@agenta/shared/state"
import {isValidUUID} from "@agenta/shared/utils"
import deepEqual from "fast-deep-equal"
import {atom, getDefaultStore} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery, queryClientAtom} from "jotai-tanstack-query"

import {queryMatchingTraces, retrieveQueryRevision} from "../api"
import type {QueryRevision} from "../core"

/** TanStack Query key prefix for the project-scoped SimpleQuery list. */
export const QUERY_LIST_KEY = "queries-list"
/** TanStack Query key prefix for a single query / its revisions. */
export const QUERY_DETAIL_KEY = "query"
/** TanStack Query key prefix for a query's head revision (molecule server data). */
export const QUERY_HEAD_KEY = "query-head"
/** TanStack Query key prefix for traces resolved from an explicit filter. */
export const MATCHING_TRACES_KEY = "matching-traces"

export const queryHeadQueryKey = (projectId: string | null | undefined, queryId: string) =>
    [QUERY_HEAD_KEY, projectId, queryId] as const

export interface MatchingTracesQueryParams {
    projectId?: string | null
    filtering?: unknown
    limit?: number
}

/**
 * Server data for the molecule: a single query's head revision (carries `name`
 * plus `data.filtering` / `data.windowing`). Keyed by the query artifact id.
 */
export const queryHeadQueryAtomFamily = atomFamily((queryId: string) =>
    atomWithQuery<QueryRevision | null>((get) => {
        const projectId = get(projectIdAtom)
        const enabled = Boolean(projectId) && isValidUUID(queryId)
        return {
            queryKey: queryHeadQueryKey(projectId, queryId),
            queryFn: async () => {
                if (!projectId || !queryId) return null
                return retrieveQueryRevision({projectId, queryRef: {id: queryId}})
            },
            enabled,
            staleTime: 60_000,
            refetchOnWindowFocus: false,
        }
    }),
)

export const matchingTracesQueryAtomFamily = atomFamily(
    ({projectId, filtering, limit = 50}: MatchingTracesQueryParams) =>
        atomWithQuery(() => ({
            queryKey: [MATCHING_TRACES_KEY, projectId, filtering, limit],
            queryFn: () =>
                queryMatchingTraces({
                    projectId: projectId as string,
                    filtering,
                    limit,
                }),
            enabled: Boolean(projectId && limit > 0),
            staleTime: 60_000,
            refetchOnWindowFocus: false,
        })),
    deepEqual,
)

/** Local edit draft for a query's head revision (null = no unsaved changes). */
export const queryHeadDraftAtomFamily = atomFamily((_queryId: string) =>
    atom<Partial<QueryRevision> | null>(null),
)

/** Invalidate the query list + detail caches after a create/commit/archive. */
export function invalidateQueryCache(): void {
    const store = getDefaultStore()
    const queryClient = store.get(queryClientAtom)
    queryClient.invalidateQueries({queryKey: [QUERY_LIST_KEY]})
    queryClient.invalidateQueries({queryKey: [QUERY_DETAIL_KEY]})
    queryClient.invalidateQueries({queryKey: [QUERY_HEAD_KEY]})
}
