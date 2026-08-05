import {atom} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryClient} from "@/oss/lib/api/queryClient"
import {
    archiveQuery,
    createQuery,
    editQuery,
    fetchQuery,
    queryQueries,
    unarchiveQuery,
} from "@/oss/services/queries/api"
import type {
    QueriesResponse,
    QueryCreateRequest,
    QueryEditRequest,
    QueryQueryRequest,
    QueryResponse,
} from "@/oss/services/queries/api/types"
import {projectIdAtom} from "@/oss/state/project"

/**
 * List queries with optional filters (payload) using atom family
 */
export const queriesQueryAtomFamily = atomFamily(
    ({payload = {}, enabled = true}: {payload?: QueryQueryRequest; enabled?: boolean} = {}) =>
        atomWithQuery<QueriesResponse>((get) => {
            const projectId = get(projectIdAtom)
            const payloadKey = JSON.stringify(payload || {})
            return {
                queryKey: ["queries", projectId, payloadKey],
                queryFn: () => queryQueries(payload),
                staleTime: 60_000,
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
                refetchOnMount: false,
                enabled: enabled && !!projectId,
            }
        }),
)

/**
 * Fetch a single query by id
 */
export const queryByIdQueryAtomFamily = atomFamily((queryId?: string) =>
    atomWithQuery<QueryResponse>((get) => {
        const projectId = get(projectIdAtom)
        return {
            queryKey: ["query", projectId, queryId],
            queryFn: () =>
                queryId ? fetchQuery(queryId) : Promise.resolve({count: 0} as QueryResponse),
            staleTime: 60_000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            refetchOnMount: false,
            enabled: !!projectId && !!queryId,
        }
    }),
)

/**
 * Mutations as writable atoms
 */
export const invalidateQueriesAtom = atom(null, async () => {
    await Promise.all([
        queryClient.invalidateQueries({queryKey: ["queries"]}),
        queryClient.invalidateQueries({queryKey: ["query"]}),
    ])
})

export const createQueryAtom = atom(
    null,
    async (_get, _set, payload: QueryCreateRequest): Promise<QueryResponse> => {
        const res = await createQuery(payload)
        await queryClient.invalidateQueries({queryKey: ["queries"]})
        return res
    },
)

export const editQueryAtom = atom(
    null,
    async (
        _get,
        _set,
        params: {queryId: string; payload: QueryEditRequest},
    ): Promise<QueryResponse> => {
        const res = await editQuery(params.queryId, params.payload)
        await Promise.all([
            queryClient.invalidateQueries({queryKey: ["queries"]}),
            queryClient.invalidateQueries({queryKey: ["query", undefined, params.queryId]}),
        ])
        return res
    },
)

export const archiveQueryAtom = atom(
    null,
    async (_get, _set, queryId: string): Promise<QueryResponse> => {
        const res = await archiveQuery(queryId)
        await queryClient.invalidateQueries({queryKey: ["queries"]})
        return res
    },
)

export const unarchiveQueryAtom = atom(
    null,
    async (_get, _set, queryId: string): Promise<QueryResponse> => {
        const res = await unarchiveQuery(queryId)
        await queryClient.invalidateQueries({queryKey: ["queries"]})
        return res
    },
)

/**
 * Small selectors
 */
export const queriesListAtomFamily = atomFamily((payload?: QueryQueryRequest) =>
    selectAtom(queriesQueryAtomFamily({payload}), (q) => q.data?.queries ?? []),
)

export const queriesCountAtomFamily = atomFamily((payload?: QueryQueryRequest) =>
    selectAtom(queriesQueryAtomFamily({payload}), (q) => q.data?.count ?? 0),
)
