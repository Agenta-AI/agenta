/**
 * Testset State Store
 *
 * Query atom families and batch fetchers for testset entities.
 * These provide the single source of truth for server data.
 */

import {projectIdAtom} from "@agenta/shared/state"
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
const revisionBatchFetcher = createBatchFetcher<RevisionDetailParams, Revision | null>({
    maxBatchSize: 50,
    flushDelay: 10,
    serializeKey: (req) => `${req.projectId}:${req.id}`,
    batchFn: async (requests, serializedKeys) => {
        const results = new Map<string, Revision | null>()

        // Group by projectId
        const byProject = new Map<string, string[]>()
        requests.forEach((req, index) => {
            const key = serializedKeys[index]
            if (!isValidUUID(req.id)) {
                results.set(key, null)
                return
            }
            const existing = byProject.get(req.projectId) || []
            existing.push(req.id)
            byProject.set(req.projectId, existing)
        })

        // Fetch revisions in batch per project
        for (const [projectId, revisionIds] of byProject) {
            if (revisionIds.length === 0) continue

            try {
                // Use batch API for better performance
                const batchResults = await fetchRevisionsBatch(projectId, revisionIds)

                // Map results back to serialized keys
                for (const revisionId of revisionIds) {
                    const key = `${projectId}:${revisionId}`
                    results.set(key, batchResults.get(revisionId) ?? null)
                }
            } catch (error) {
                console.error("[revisionBatchFetcher] Batch fetch failed, falling back:", error)

                // Fallback to individual fetches on batch failure
                for (const revisionId of revisionIds) {
                    const key = `${projectId}:${revisionId}`
                    try {
                        const revision = await fetchRevision({id: revisionId, projectId})
                        results.set(key, revision)
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
        const isEnabled = Boolean(projectId && revisionId && isValidUUID(revisionId))

        return {
            queryKey: ["revision", projectId, revisionId],
            queryFn: async () => {
                if (!projectId || !revisionId || !isValidUUID(revisionId)) {
                    return null
                }
                return revisionBatchFetcher({projectId, id: revisionId})
            },
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
    fetchFn: (testsetId, projectId) => latestRevisionBatchFetcher({testsetId, projectId}),
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
        const isEnabled = Boolean(projectId && testsetId && isRequested)

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
 * Query atom for fetching a single testset
 */
export const testsetQueryAtomFamily = atomFamily((testsetId: string) =>
    atomWithQuery<Testset | null>((get) => {
        const projectId = get(projectIdAtom)
        const queryClient = get(queryClientAtom)

        const isNew = isNewTestsetId(testsetId)
        const mockTestset = isNew ? createMockTestset() : undefined
        const cachedData =
            testsetId && !isNew ? findTestsetInCache(queryClient, testsetId) : undefined
        const isEnabled = Boolean(projectId && testsetId && !cachedData && !isNew)

        return {
            queryKey: ["testset", projectId, testsetId],
            queryFn: async () => {
                if (!projectId || !testsetId) return null
                if (isNew) return createMockTestset()
                return fetchTestsetDetail({id: testsetId, projectId})
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
            enabled: Boolean(projectId),
            staleTime: 60_000,
            gcTime: 5 * 60_000,
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
            enabled: Boolean(projectId && variantId && !cachedData),
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
