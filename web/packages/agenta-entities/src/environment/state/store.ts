/**
 * Environment State Store
 *
 * Query atom families for environment entities.
 * These provide the single source of truth for server data.
 */

import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {createBatchFetcher, isValidUUID} from "@agenta/shared/utils"
import {atom, getDefaultStore} from "jotai"
import type {PrimitiveAtom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery, queryClientAtom} from "jotai-tanstack-query"

import {
    fetchEnvironmentDetail,
    fetchEnvironmentsList,
    fetchEnvironmentRevisionsList,
    fetchEnvironmentsBatch,
} from "../api"
import type {Environment, EnvironmentRevisionListItem, EnvironmentsResponse} from "../core"

// ============================================================================
// ENVIRONMENT QUERY ATOMS
// ============================================================================

type QueryClient = import("@tanstack/react-query").QueryClient

interface EnvironmentRequest {
    projectId: string
    environmentId: string
    queryClient?: QueryClient
}

function primeEnvironmentDetailCache(
    queryClient: QueryClient,
    projectId: string,
    environment: Environment | null | undefined,
): void {
    if (!environment?.id) return
    queryClient.setQueryData(["environment", projectId, environment.id], environment)
}

function findEnvironmentInDetailCache(
    queryClient: QueryClient,
    projectId: string,
    environmentId: string,
): Environment | undefined {
    return queryClient.getQueryData<Environment>(["environment", projectId, environmentId])
}

function findEnvironmentInListCaches(
    queryClient: QueryClient,
    projectId: string,
    environmentId: string,
): Environment | undefined {
    const listQueries = queryClient.getQueriesData<EnvironmentsResponse>({
        predicate: (query) => {
            const key = query.queryKey
            return key[0] === "environments-list" && key[1] === projectId
        },
    })

    for (const [_queryKey, data] of listQueries) {
        const found = data?.environments?.find((env) => env.id === environmentId)
        if (found) return found
    }

    return undefined
}

function findEnvironmentInCache(
    queryClient: QueryClient,
    projectId: string,
    environmentId: string,
): Environment | undefined {
    return (
        findEnvironmentInDetailCache(queryClient, projectId, environmentId) ??
        findEnvironmentInListCaches(queryClient, projectId, environmentId)
    )
}

const environmentBatchFetcher = createBatchFetcher<EnvironmentRequest, Environment | null>({
    maxBatchSize: 50,
    flushDelay: 10,
    serializeKey: (req) => `${req.projectId}:${req.environmentId}`,
    batchFn: async (requests, serializedKeys) => {
        const results = new Map<string, Environment | null>()
        const byProject = new Map<
            string,
            {environmentIds: string[]; keys: string[]; queryClients: Set<QueryClient>}
        >()

        requests.forEach((req, index) => {
            const key = serializedKeys[index]
            if (!req.projectId || !req.environmentId || !isValidUUID(req.environmentId)) {
                results.set(key, null)
                return
            }

            if (req.queryClient) {
                const cached = findEnvironmentInCache(
                    req.queryClient,
                    req.projectId,
                    req.environmentId,
                )
                if (cached) {
                    results.set(key, cached)
                    return
                }
            }

            const existing = byProject.get(req.projectId)
            if (existing) {
                existing.environmentIds.push(req.environmentId)
                existing.keys.push(key)
                if (req.queryClient) existing.queryClients.add(req.queryClient)
            } else {
                byProject.set(req.projectId, {
                    environmentIds: [req.environmentId],
                    keys: [key],
                    queryClients: new Set(req.queryClient ? [req.queryClient] : []),
                })
            }
        })

        await Promise.all(
            Array.from(byProject.entries()).map(async ([projectId, group]) => {
                try {
                    const environmentMap = await fetchEnvironmentsBatch(
                        projectId,
                        group.environmentIds,
                    )

                    group.environmentIds.forEach((environmentId, index) => {
                        const key = group.keys[index]
                        const environment = environmentMap.get(environmentId) ?? null
                        results.set(key, environment)

                        if (environment) {
                            group.queryClients.forEach((queryClient) => {
                                primeEnvironmentDetailCache(queryClient, projectId, environment)
                            })
                        }
                    })
                } catch (error) {
                    console.error(
                        "[environmentBatchFetcher] Batch fetch failed, falling back:",
                        group.environmentIds,
                        error,
                    )

                    await Promise.all(
                        group.environmentIds.map(async (environmentId, index) => {
                            const key = group.keys[index]
                            try {
                                const environment = await fetchEnvironmentDetail({
                                    id: environmentId,
                                    projectId,
                                })
                                results.set(key, environment)
                                group.queryClients.forEach((queryClient) => {
                                    primeEnvironmentDetailCache(queryClient, projectId, environment)
                                })
                            } catch (individualError) {
                                console.error(
                                    "[environmentBatchFetcher] Individual fetch failed:",
                                    environmentId,
                                    individualError,
                                )
                                results.set(key, null)
                            }
                        }),
                    )
                }
            }),
        )

        return results
    },
})

/**
 * Query atom for fetching a single environment (SimpleEnvironment)
 */
export const environmentQueryAtomFamily = atomFamily((environmentId: string) =>
    atomWithQuery<Environment | null>((get) => {
        const projectId = get(projectIdAtom)
        const queryClient = get(queryClientAtom)
        const detailCached =
            projectId && environmentId
                ? findEnvironmentInCache(queryClient, projectId, environmentId)
                : undefined
        const isEnabled = Boolean(
            projectId && environmentId && isValidUUID(environmentId) && !detailCached,
        )

        return {
            queryKey: ["environment", projectId, environmentId],
            queryFn: async () => {
                if (!projectId || !environmentId || !isValidUUID(environmentId)) {
                    return null
                }
                const cached = findEnvironmentInCache(queryClient, projectId, environmentId)
                if (cached) return cached

                return environmentBatchFetcher({projectId, environmentId, queryClient})
            },
            initialData: detailCached ?? undefined,
            enabled: get(sessionAtom) && isEnabled,
            staleTime: 30_000,
            gcTime: 5 * 60_000,
        }
    }),
)

/**
 * Query atom for fetching environments list
 */
export const environmentsListQueryAtomFamily = atomFamily((includeArchived: boolean | null) =>
    atomWithQuery<EnvironmentsResponse>((get) => {
        const projectId = get(projectIdAtom)
        const queryClient = get(queryClientAtom)

        return {
            queryKey: ["environments-list", projectId, includeArchived ?? false],
            queryFn: async () => {
                if (!projectId) return {environments: [], count: 0}
                const response = await fetchEnvironmentsList({
                    projectId,
                    includeArchived: includeArchived ?? false,
                })
                for (const environment of response.environments ?? []) {
                    primeEnvironmentDetailCache(queryClient, projectId, environment)
                }
                return response
            },
            enabled: get(sessionAtom) && Boolean(projectId),
            staleTime: 30_000,
            gcTime: 5 * 60_000,
        }
    }),
)

// ============================================================================
// ENVIRONMENT DRAFT ATOMS
// ============================================================================

/**
 * Draft state for an environment (local edits)
 */
export const environmentDraftAtomFamily = atomFamily((_environmentId: string) =>
    atom<Partial<Environment> | null>(null),
) as unknown as {
    (id: string): PrimitiveAtom<Partial<Environment> | null>
    remove: (id: string) => void
    setShouldRemove: (fn: ((createdAt: number, id: string) => boolean) | null) => void
    getParams: () => Iterable<string>
}

// ============================================================================
// ENVIRONMENT REVISIONS LIST QUERY
// ============================================================================

/**
 * Store projectId per environment for revisions list query
 */
const revisionsListProjectIdMapAtom = atom<Map<string, string>>(new Map())

/**
 * Track which environments have had their revisions list requested
 */
const revisionsListRequestedAtom = atom<Set<string>>(new Set<string>())

/**
 * Enable revisions list query for an environment with its projectId
 */
export const enableRevisionsListQueryAtom = atom<
    null,
    [{environmentId: string; projectId: string}],
    void
>(null, (get, set, params: {environmentId: string; projectId: string}) => {
    const {environmentId, projectId} = params

    const projectIdMap = new Map(get(revisionsListProjectIdMapAtom))
    projectIdMap.set(environmentId, projectId)
    set(revisionsListProjectIdMapAtom, projectIdMap)

    const requested = new Set(get(revisionsListRequestedAtom))
    requested.add(environmentId)
    set(revisionsListRequestedAtom, requested)
})

/**
 * Query atom for fetching revisions list for an environment
 */
export const revisionsListQueryAtomFamily = atomFamily((environmentId: string) =>
    atomWithQuery<EnvironmentRevisionListItem[]>((get) => {
        const projectIdMap = get(revisionsListProjectIdMapAtom)
        const projectId = projectIdMap.get(environmentId) ?? null
        const requested = get(revisionsListRequestedAtom)
        const isRequested = requested.has(environmentId)
        const isEnabled = get(sessionAtom) && Boolean(projectId && environmentId && isRequested)

        return {
            queryKey: ["environment-revisions-list", projectId, environmentId],
            queryFn: async () => {
                if (!projectId || !environmentId) return []

                const response = await fetchEnvironmentRevisionsList({projectId, environmentId})
                return response.environment_revisions.map((raw) => ({
                    id: raw.id,
                    version: raw.version,
                    created_at: raw.created_at,
                    message: raw.message,
                    author: raw.author ?? raw.created_by_id ?? null,
                }))
            },
            enabled: isEnabled,
            staleTime: 30_000,
        }
    }),
)

// ============================================================================
// REVISION DEPLOYMENT LOOKUP
// ============================================================================

/**
 * Deployment info for a revision — which environments it's deployed in.
 */
export interface RevisionDeployment {
    /** Environment name (e.g. "production", "staging") */
    name: string
    /** Environment ID */
    id: string
    /** Environment slug */
    slug: string | null
}

/**
 * Atom family that returns environments where a given revision is deployed.
 *
 * Reads from the environments list (new SimpleEnvironment API) and checks
 * each environment's `data.references` for the given revisionId.
 *
 * Returns `RevisionDeployment[]` — compatible with `{name: string}[]`
 * expected by `VariantDetailsWithStatus`.
 */
export const revisionDeploymentAtomFamily = atomFamily((revisionId: string) =>
    atom<RevisionDeployment[]>((get) => {
        if (!revisionId) return []

        const listQuery = get(environmentsListQueryAtomFamily(false))
        const environments = listQuery.data?.environments ?? []

        const result: RevisionDeployment[] = []

        for (const env of environments) {
            if (!env.data?.references) continue

            for (const appKey of Object.keys(env.data.references)) {
                const appRefs = env.data.references[appKey]
                if (appRefs?.application_revision?.id === revisionId) {
                    result.push({
                        name: env.name ?? env.slug ?? "unknown",
                        id: env.id,
                        slug: env.slug ?? null,
                    })
                    break // found in this env, move to next
                }
            }
        }

        return result
    }),
)

// ============================================================================
// CACHE INVALIDATION
// ============================================================================

/**
 * Invalidate the environments list cache
 */
export function invalidateEnvironmentsListCache(): void {
    const store = getDefaultStore()
    const queryClient = store.get(queryClientAtom)
    queryClient.invalidateQueries({queryKey: ["environments-list"]})
}

/**
 * Invalidate a specific environment's cache
 */
export function invalidateEnvironmentCache(environmentId: string): void {
    const store = getDefaultStore()
    const queryClient = store.get(queryClientAtom)
    queryClient.invalidateQueries({
        queryKey: ["environment"],
        predicate: (query) =>
            query.queryKey[0] === "environment" && query.queryKey[2] === environmentId,
    })
}

/**
 * Invalidate the revisions list cache for a specific environment
 */
export function invalidateEnvironmentRevisionsListCache(environmentId: string): void {
    const store = getDefaultStore()
    const queryClient = store.get(queryClientAtom)
    queryClient.invalidateQueries({
        queryKey: ["environment-revisions-list"],
        predicate: (query) =>
            query.queryKey[0] === "environment-revisions-list" &&
            query.queryKey[2] === environmentId,
    })
}
