/**
 * Testset State Store
 *
 * Query atom families and batch fetchers for testset entities.
 * These provide the single source of truth for server data.
 */

import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {createBatchFetcher, isValidUUID} from "@agenta/shared/utils"
import {atom, getDefaultStore} from "jotai"
import type {PrimitiveAtom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery, queryClientAtom} from "jotai-tanstack-query"

import {createLatestEntityQueryFactory} from "../../shared"
import {
    fetchRevision,
    fetchRevisionsBatch,
    fetchRevisionsList,
    fetchLatestRevisionsBatch,
    fetchTestsetDetail,
    fetchTestsetsBatch,
    fetchTestsetsList,
    fetchVariantDetail,
    findTestsetInCache,
    findVariantInCache,
} from "../api"
import {
    isNewTestsetId,
    type Revision,
    type RevisionListItem,
    type Testset,
    type Variant,
} from "../core"
import type {RevisionDetailParams, TestsetsResponse} from "../core"

// ============================================================================
// REVISION BATCH FETCHER
// ============================================================================

type QueryClient = import("@tanstack/react-query").QueryClient

interface RevisionRequest extends RevisionDetailParams {
    queryClient?: QueryClient
}

function primeRevisionDetailCache(
    queryClient: QueryClient,
    projectId: string,
    revision: Revision | null | undefined,
): void {
    if (!revision?.id) return
    queryClient.setQueryData(["revision", projectId, revision.id], revision)
}

function primeLatestRevisionCacheForTestset(
    queryClient: QueryClient,
    projectId: string,
    revision: Revision | null | undefined,
): void {
    if (!revision?.testset_id) return

    const existing = queryClient.getQueryData<Revision>([
        "latest-revision",
        projectId,
        revision.testset_id,
    ])
    if (!existing || (revision.version ?? 0) > (existing.version ?? 0)) {
        queryClient.setQueryData(["latest-revision", projectId, revision.testset_id], revision)
    }
}

function findRevisionInDetailCache(
    queryClient: QueryClient,
    projectId: string,
    revisionId: string,
): Revision | undefined {
    return queryClient.getQueryData<Revision>(["revision", projectId, revisionId])
}

function findRevisionInLatestCaches(
    queryClient: QueryClient,
    projectId: string,
    revisionId: string,
): Revision | undefined {
    const latestQueries = queryClient.getQueriesData<Revision | null>({
        queryKey: ["latest-revision", projectId],
    })

    for (const [_queryKey, data] of latestQueries) {
        if (data?.id === revisionId) return data
    }

    return undefined
}

function findRevisionInCache(
    queryClient: QueryClient,
    projectId: string,
    revisionId: string,
): Revision | undefined {
    return (
        findRevisionInDetailCache(queryClient, projectId, revisionId) ??
        findRevisionInLatestCaches(queryClient, projectId, revisionId)
    )
}

function findLatestRevisionForTestsetInCache(
    queryClient: QueryClient,
    projectId: string,
    testsetId: string,
): Revision | undefined {
    const direct = queryClient.getQueryData<Revision>(["latest-revision", projectId, testsetId])
    if (direct) return direct

    const revisionQueries = queryClient.getQueriesData<Revision | null>({
        queryKey: ["revision", projectId],
    })

    let latest: Revision | null = null
    for (const [_queryKey, data] of revisionQueries) {
        if (!data || data.testset_id !== testsetId) continue
        if (!latest || (data.version ?? 0) > (latest.version ?? 0)) {
            latest = data
        }
    }

    return latest ?? undefined
}

/**
 * Batch fetcher for revision requests.
 *
 * Uses createBatchFetcher for request deduplication and batching, which groups
 * concurrent requests within a 10ms window. Fetches revisions in batches using
 * the batch query API for better performance.
 *
 * Benefits:
 * - Deduplicates concurrent requests for the same revision
 * - Groups requests by project and fetches in a single API call per project
 * - Falls back to individual fetches on batch failure
 */
const revisionBatchFetcher = createBatchFetcher<RevisionRequest, Revision | null>({
    maxBatchSize: 50,
    flushDelay: 10,
    serializeKey: (req) => `${req.projectId}:${req.id}`,
    batchFn: async (requests, serializedKeys) => {
        const results = new Map<string, Revision | null>()

        // Group by projectId and resolve from cache first
        const byProject = new Map<string, string[]>()
        const queryClientsByProject = new Map<string, Set<QueryClient>>()
        requests.forEach((req, index) => {
            const key = serializedKeys[index]
            if (!isValidUUID(req.id)) {
                results.set(key, null)
                return
            }

            if (req.queryClient) {
                const cached = findRevisionInCache(req.queryClient, req.projectId, req.id)
                if (cached) {
                    results.set(key, cached)
                    return
                }
            }

            const existing = byProject.get(req.projectId) || []
            existing.push(req.id)
            byProject.set(req.projectId, existing)
            if (req.queryClient) {
                const clients = queryClientsByProject.get(req.projectId) ?? new Set<QueryClient>()
                clients.add(req.queryClient)
                queryClientsByProject.set(req.projectId, clients)
            }
        })

        // Fetch revisions in batch per project
        for (const [projectId, revisionIds] of byProject) {
            if (revisionIds.length === 0) continue

            try {
                // Use batch API for better performance
                const batchResults = await fetchRevisionsBatch(projectId, revisionIds)
                const queryClients = queryClientsByProject.get(projectId) ?? new Set<QueryClient>()

                // Map results back to serialized keys
                for (const revisionId of revisionIds) {
                    const key = `${projectId}:${revisionId}`
                    const revision = batchResults.get(revisionId) ?? null
                    results.set(key, revision)

                    if (revision) {
                        queryClients.forEach((queryClient) => {
                            primeRevisionDetailCache(queryClient, projectId, revision)
                            primeLatestRevisionCacheForTestset(queryClient, projectId, revision)
                        })
                    }
                }
            } catch (error) {
                console.error("[revisionBatchFetcher] Batch fetch failed, falling back:", error)

                // Fallback to individual fetches on batch failure
                for (const revisionId of revisionIds) {
                    const key = `${projectId}:${revisionId}`
                    try {
                        const revision = await fetchRevision({id: revisionId, projectId})
                        results.set(key, revision)
                        const queryClients = queryClientsByProject.get(projectId)
                        queryClients?.forEach((queryClient) => {
                            primeRevisionDetailCache(queryClient, projectId, revision)
                            primeLatestRevisionCacheForTestset(queryClient, projectId, revision)
                        })
                    } catch (individualError) {
                        console.error(
                            "[revisionBatchFetcher] Individual fetch failed:",
                            revisionId,
                            individualError,
                        )
                        results.set(key, null)
                    }
                }
            }
        }

        return results
    },
})

// ============================================================================
// REVISION QUERY ATOMS
// ============================================================================

/**
 * Current testset ID context for revision queries
 */
export const currentTestsetIdForRevisionsAtom = atom<string | null>(null)

/**
 * List of revision IDs for current testset
 */
export const revisionIdsAtom = atom<string[]>([])

/**
 * Set revision IDs (called when revisions list query completes)
 */
export const setRevisionIdsAtom = atom(null, (_get, set, ids: string[]) => {
    set(revisionIdsAtom, ids)
})

/**
 * Query atom for fetching a single revision
 */
export const revisionQueryAtomFamily = atomFamily((revisionId: string) =>
    atomWithQuery<Revision | null>((get) => {
        const projectId = get(projectIdAtom)
        const queryClient = get(queryClientAtom)
        const detailCached =
            projectId && revisionId
                ? findRevisionInDetailCache(queryClient, projectId, revisionId)
                : undefined
        const isEnabled =
            get(sessionAtom) &&
            Boolean(projectId && revisionId && isValidUUID(revisionId) && !detailCached)

        return {
            queryKey: ["revision", projectId, revisionId],
            queryFn: async () => {
                if (!projectId || !revisionId || !isValidUUID(revisionId)) {
                    return null
                }
                const cached = findRevisionInCache(queryClient, projectId, revisionId)
                if (cached) return cached
                return revisionBatchFetcher({projectId, id: revisionId, queryClient})
            },
            initialData: detailCached ?? undefined,
            enabled: isEnabled,
            // Revisions are immutable - never stale
            staleTime: Infinity,
            gcTime: Infinity,
        }
    }),
)

// ============================================================================
// LATEST REVISION BATCH FETCHER
// ============================================================================

interface LatestRevisionRequest {
    testsetId: string
    projectId: string
}

/**
 * Batch fetcher that combines concurrent latest revision requests into a single API call
 * Collects requests within a 10ms window and fetches all at once
 */
const latestRevisionBatchFetcher = createBatchFetcher<LatestRevisionRequest, Revision | null>({
    maxBatchSize: 50,
    flushDelay: 10,
    serializeKey: (req) => `${req.projectId}:${req.testsetId}`,
    batchFn: async (requests, serializedKeys) => {
        const results = new Map<string, Revision | null>()

        // Group by projectId (should typically be same project)
        const byProject = new Map<string, string[]>()
        requests.forEach((req, index) => {
            const key = serializedKeys[index]
            if (!req.testsetId) {
                results.set(key, null)
                return
            }
            const existing = byProject.get(req.projectId) || []
            existing.push(req.testsetId)
            byProject.set(req.projectId, existing)
        })

        // Batch fetch for each project
        for (const [projectId, testsetIds] of byProject) {
            if (testsetIds.length === 0) continue

            try {
                const revisionMap = await fetchLatestRevisionsBatch(projectId, testsetIds)

                // Map results back to serialized keys
                for (const testsetId of testsetIds) {
                    const key = `${projectId}:${testsetId}`
                    results.set(key, revisionMap.get(testsetId) ?? null)
                }
            } catch (error) {
                console.error(
                    "[latestRevisionBatchFetcher] Failed to fetch batch:",
                    testsetIds,
                    error,
                )
                // Set null for all failed requests
                for (const testsetId of testsetIds) {
                    const key = `${projectId}:${testsetId}`
                    results.set(key, null)
                }
            }
        }

        return results
    },
})

// ============================================================================
// LATEST REVISION QUERY (using factory with batch fetcher)
// ============================================================================

/**
 * Factory instance for latest revision queries
 * Uses createLatestEntityQueryFactory with batch fetching for optimal performance
 */
const latestRevisionQuery = createLatestEntityQueryFactory<Revision>({
    queryKeyPrefix: "latest-revision",
    fetchFn: async (testsetId, projectId) => {
        const store = getDefaultStore()
        const queryClient = store.get(queryClientAtom)
        const cached = findLatestRevisionForTestsetInCache(queryClient, projectId, testsetId)
        if (cached) return cached
        return latestRevisionBatchFetcher({testsetId, projectId})
    },
    staleTime: 30_000,
})

/**
 * Query atom for fetching only the latest revision for a testset (optimized)
 * Uses fetchLatestRevision which fetches limit: 1 instead of 100
 */
export const latestRevisionQueryAtomFamily = latestRevisionQuery.queryAtomFamily

/**
 * Stateful atom for latest revision with loading state
 * Returns { data, isPending } for components that need loading state
 */
export const latestRevisionStatefulAtomFamily = latestRevisionQuery.statefulAtomFamily

/**
 * Action atom to request latest revision for a testset
 * This enables the latest revision query and triggers a fetch
 *
 * @example
 * const request = useSetAtom(requestLatestRevisionAtom)
 * request({ testsetId: '...', projectId: '...' })
 */
export const requestLatestRevisionAtom = atom<null, [{testsetId: string; projectId: string}], void>(
    null,
    (_get, set, {testsetId, projectId}) => {
        if (!testsetId || !projectId) return
        set(latestRevisionQuery.requestAtom, {parentId: testsetId, projectId})
    },
)

// ============================================================================
// REVISIONS LIST QUERY (separate from latest revision)
// ============================================================================

/**
 * Store projectId per testset for revisions list query
 * This avoids relying on a global projectIdAtom that may not be synced
 */
const revisionsListProjectIdMapAtom = atom<Map<string, string>>(new Map())

/**
 * Track which testsets have had their revisions list requested
 */
const revisionsListRequestedAtom = atom<Set<string>>(new Set<string>())

/**
 * Enable revisions list query for a testset with its projectId
 * Used when expanding testset rows to see all revisions
 */
export const enableRevisionsListQueryAtom = atom<
    null,
    [{testsetId: string; projectId: string}],
    void
>(null, (get, set, params: {testsetId: string; projectId: string}) => {
    const {testsetId, projectId} = params

    // Store the projectId for this testset
    const projectIdMap = new Map(get(revisionsListProjectIdMapAtom))
    projectIdMap.set(testsetId, projectId)
    set(revisionsListProjectIdMapAtom, projectIdMap)

    // Mark as requested
    const requested = new Set(get(revisionsListRequestedAtom))
    requested.add(testsetId)
    set(revisionsListRequestedAtom, requested)
})

/**
 * Query atom for fetching revisions list for a testset
 * Used when expanding testset rows to show all revision history
 */
export const revisionsListQueryAtomFamily = atomFamily((testsetId: string) =>
    atomWithQuery<RevisionListItem[]>((get) => {
        // Get projectId from the map (set when request was made)
        const projectIdMap = get(revisionsListProjectIdMapAtom)
        const projectId = projectIdMap.get(testsetId) ?? null
        const requested = get(revisionsListRequestedAtom)
        const isRequested = requested.has(testsetId)
        const isEnabled = get(sessionAtom) && Boolean(projectId && testsetId && isRequested)

        return {
            queryKey: ["revisions-list", projectId, testsetId],
            queryFn: async () => {
                if (!projectId || !testsetId) return []

                const response = await fetchRevisionsList({projectId, testsetId})
                return response.testset_revisions.map((raw) => ({
                    id: raw.id,
                    version: raw.version,
                    created_at: raw.created_at ?? raw.date,
                    message: raw.message,
                    author: raw.author ?? raw.created_by_id ?? null,
                }))
            },
            enabled: isEnabled,
            staleTime: 30_000,
        }
    }),
)

/**
 * Derived atom that gets the latest revision from the revisions list query
 * @deprecated Use latestRevisionQueryAtomFamily for optimized single-revision fetch
 */
export const latestRevisionForTestsetAtomFamily = atomFamily((testsetId: string) =>
    atom((get) => {
        const query = get(revisionsListQueryAtomFamily(testsetId))
        const revisions = query.data ?? []
        const nonV0 = revisions.find((r) => r.version > 0)
        return nonV0 ?? revisions[0] ?? null
    }),
)

/**
 * Alias for backward compatibility
 * @deprecated Use latestRevisionQueryAtomFamily for optimized single-revision fetch
 */
export const latestRevisionAtomFamily = latestRevisionForTestsetAtomFamily

// ============================================================================
// REVISION DRAFT ATOMS
// ============================================================================

/**
 * Draft state for a revision (local edits)
 */
export const revisionDraftAtomFamily = atomFamily((_revisionId: string) =>
    atom<Partial<Revision> | null>(null),
) as unknown as {
    (id: string): PrimitiveAtom<Partial<Revision> | null>
    remove: (id: string) => void
    setShouldRemove: (fn: ((createdAt: number, id: string) => boolean) | null) => void
    getParams: () => Iterable<string>
}

// ============================================================================
// TESTSET BATCH FETCHER
// ============================================================================

interface TestsetRequest {
    projectId: string
    testsetId: string
    queryClient?: QueryClient
}

function primeTestsetDetailCache(
    queryClient: QueryClient,
    projectId: string,
    testset: Testset | null | undefined,
): void {
    if (!testset?.id) return
    queryClient.setQueryData(["testset", projectId, testset.id], testset)
}

/**
 * Batch fetcher for testset requests.
 *
 * Uses createBatchFetcher for request deduplication and batching, which groups
 * concurrent requests within a 10ms window. Fetches testsets in batches using
 * POST /testsets/query for better performance.
 */
const testsetBatchFetcher = createBatchFetcher<TestsetRequest, Testset | null>({
    maxBatchSize: 50,
    flushDelay: 10,
    serializeKey: (req) => `${req.projectId}:${req.testsetId}`,
    batchFn: async (requests, serializedKeys) => {
        const results = new Map<string, Testset | null>()

        // Group by projectId and resolve from cache first
        const byProject = new Map<
            string,
            {
                queryClient?: QueryClient
                toFetch: {key: string; testsetId: string}[]
            }
        >()

        requests.forEach((req, index) => {
            const key = serializedKeys[index]
            if (!isValidUUID(req.testsetId)) {
                results.set(key, null)
                return
            }

            // Check TanStack Query cache first
            if (req.queryClient) {
                const cached = findTestsetInCache(req.queryClient, req.testsetId)
                if (cached) {
                    results.set(key, cached)
                    return
                }
            }

            const group = byProject.get(req.projectId)
            if (group) {
                group.toFetch.push({key, testsetId: req.testsetId})
                if (!group.queryClient && req.queryClient) {
                    group.queryClient = req.queryClient
                }
            } else {
                byProject.set(req.projectId, {
                    queryClient: req.queryClient,
                    toFetch: [{key, testsetId: req.testsetId}],
                })
            }
        })

        // Fetch each project's testsets in batch
        await Promise.all(
            Array.from(byProject.entries()).map(async ([projectId, {queryClient, toFetch}]) => {
                if (toFetch.length === 0) return

                const testsetIds = toFetch.map((t) => t.testsetId)

                try {
                    const batchResults = await fetchTestsetsBatch(projectId, testsetIds)

                    toFetch.forEach(({key, testsetId}) => {
                        const testset = batchResults.get(testsetId) ?? null
                        results.set(key, testset)

                        // Prime individual query cache entries
                        if (queryClient && testset) {
                            primeTestsetDetailCache(queryClient, projectId, testset)
                        }
                    })
                } catch {
                    // Fall back to individual fetches
                    await Promise.all(
                        toFetch.map(async ({key, testsetId}) => {
                            try {
                                const testset = await fetchTestsetDetail({
                                    id: testsetId,
                                    projectId,
                                })
                                results.set(key, testset)
                                if (queryClient && testset) {
                                    primeTestsetDetailCache(queryClient, projectId, testset)
                                }
                            } catch {
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

// ============================================================================
// TESTSET QUERY ATOMS
// ============================================================================

/**
 * Create a mock testset for new (unsaved) testsets
 */
const createMockTestset = (): Testset => ({
    id: "new",
    name: "",
    description: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
})

/**
 * Query atom for fetching a single testset.
 * Uses batch fetcher to combine concurrent requests into a single API call.
 */
export const testsetQueryAtomFamily = atomFamily((testsetId: string) =>
    atomWithQuery<Testset | null>((get) => {
        const projectId = get(projectIdAtom)
        const queryClient = get(queryClientAtom)

        const isNew = isNewTestsetId(testsetId)
        const mockTestset = isNew ? createMockTestset() : undefined
        const cachedData =
            testsetId && !isNew ? findTestsetInCache(queryClient, testsetId) : undefined
        const isEnabled =
            get(sessionAtom) && Boolean(projectId && testsetId && !cachedData && !isNew)

        return {
            queryKey: ["testset", projectId, testsetId],
            queryFn: async () => {
                if (!projectId || !testsetId) return null
                if (isNew) return createMockTestset()
                return testsetBatchFetcher({
                    projectId,
                    testsetId,
                    queryClient,
                })
            },
            initialData: cachedData ?? mockTestset ?? undefined,
            enabled: isEnabled,
            staleTime: isNew ? Infinity : 60_000,
            gcTime: isNew ? Infinity : 5 * 60_000,
        }
    }),
)

/**
 * Query atom for fetching testsets list
 */
export const testsetsListQueryAtomFamily = atomFamily((searchQuery: string | null) =>
    atomWithQuery<TestsetsResponse>((get) => {
        const projectId = get(projectIdAtom)

        return {
            queryKey: ["testsets-list", projectId, searchQuery ?? ""],
            queryFn: async () => {
                if (!projectId) return {testsets: [], count: 0}
                return fetchTestsetsList({projectId, searchQuery})
            },
            enabled: get(sessionAtom) && Boolean(projectId),
            staleTime: 60_000,
            gcTime: 5 * 60_000,
            refetchOnMount: "always",
        }
    }),
)

// ============================================================================
// TESTSET DRAFT ATOMS
// ============================================================================

/**
 * Draft state for a testset (local edits)
 */
export const testsetDraftAtomFamily = atomFamily((_testsetId: string) =>
    atom<Partial<Testset> | null>(null),
) as unknown as {
    (id: string): PrimitiveAtom<Partial<Testset> | null>
    remove: (id: string) => void
    setShouldRemove: (fn: ((createdAt: number, id: string) => boolean) | null) => void
    getParams: () => Iterable<string>
}

// ============================================================================
// VARIANT QUERY ATOMS
// ============================================================================

/**
 * Query atom for fetching a single variant
 */
export const variantQueryAtomFamily = atomFamily((variantId: string) =>
    atomWithQuery<Variant | null>((get) => {
        const projectId = get(projectIdAtom)
        const queryClient = get(queryClientAtom)

        const cachedData = variantId ? findVariantInCache(queryClient, variantId) : undefined

        return {
            queryKey: ["variant", projectId, variantId],
            queryFn: async () => {
                if (!projectId || !variantId) return null
                return fetchVariantDetail({id: variantId, projectId})
            },
            initialData: cachedData ?? undefined,
            enabled: get(sessionAtom) && Boolean(projectId && variantId && !cachedData),
            staleTime: 60_000,
            gcTime: 5 * 60_000,
        }
    }),
)

// ============================================================================
// CACHE INVALIDATION
// ============================================================================

/**
 * Invalidate the testsets list cache
 */
export function invalidateTestsetsListCache(): void {
    const store = getDefaultStore()
    const queryClient = store.get(queryClientAtom)
    queryClient.invalidateQueries({queryKey: ["testsets-list"]})
}

/**
 * Invalidate a specific testset's cache
 */
export function invalidateTestsetCache(testsetId: string): void {
    const store = getDefaultStore()
    const queryClient = store.get(queryClientAtom)
    queryClient.invalidateQueries({
        queryKey: ["testset"],
        predicate: (query) => query.queryKey[0] === "testset" && query.queryKey[2] === testsetId,
    })
}

/**
 * Invalidate the revisions list cache for a specific testset
 */
export function invalidateRevisionsListCache(testsetId: string): void {
    const store = getDefaultStore()
    const queryClient = store.get(queryClientAtom)
    queryClient.invalidateQueries({
        queryKey: ["revisions-list"],
        predicate: (query) =>
            query.queryKey[0] === "revisions-list" && query.queryKey[2] === testsetId,
    })
}
