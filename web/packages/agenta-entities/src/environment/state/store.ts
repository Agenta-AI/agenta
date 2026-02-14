/**
 * Environment State Store
 *
 * Query atom families for environment entities.
 * These provide the single source of truth for server data.
 */

import {projectIdAtom} from "@agenta/shared/state"
import {isValidUUID} from "@agenta/shared/utils"
import {atom, getDefaultStore} from "jotai"
import type {PrimitiveAtom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery, queryClientAtom} from "jotai-tanstack-query"

import {fetchEnvironmentDetail, fetchEnvironmentsList, fetchEnvironmentRevisionsList} from "../api"
import type {Environment, EnvironmentRevisionListItem, EnvironmentsResponse} from "../core"

// ============================================================================
// ENVIRONMENT QUERY ATOMS
// ============================================================================

/**
 * Query atom for fetching a single environment (SimpleEnvironment)
 */
export const environmentQueryAtomFamily = atomFamily((environmentId: string) =>
    atomWithQuery<Environment | null>((get) => {
        const projectId = get(projectIdAtom)
        const isEnabled = Boolean(projectId && environmentId && isValidUUID(environmentId))

        return {
            queryKey: ["environment", projectId, environmentId],
            queryFn: async () => {
                if (!projectId || !environmentId || !isValidUUID(environmentId)) {
                    return null
                }
                return fetchEnvironmentDetail({id: environmentId, projectId})
            },
            enabled: isEnabled,
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

        return {
            queryKey: ["environments-list", projectId, includeArchived ?? false],
            queryFn: async () => {
                if (!projectId) return {environments: [], count: 0}
                return fetchEnvironmentsList({
                    projectId,
                    includeArchived: includeArchived ?? false,
                })
            },
            enabled: Boolean(projectId),
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
        const isEnabled = Boolean(projectId && environmentId && isRequested)

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
