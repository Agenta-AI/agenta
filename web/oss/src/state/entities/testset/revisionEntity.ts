import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {projectIdAtom} from "@/oss/state/project/selectors/project"
import createBatchFetcher from "@/oss/state/utils/createBatchFetcher"

import {normalizeRevision, type Revision, type RevisionListItem} from "./revisionSchema"

// ============================================================================
// REVISION IDS ATOM
// List of revision IDs for a testset - populated by query
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
export const setRevisionIdsAtom = atom(null, (get, set, ids: string[]) => {
    set(revisionIdsAtom, ids)
})

// ============================================================================
// BATCH FETCHER FOR REVISIONS
// Collects concurrent single-revision requests and batches them
// ============================================================================

interface RevisionRequest {
    projectId: string
    revisionId: string
}

/**
 * Check if a string is a valid UUID
 */
const isValidUUID = (id: string): boolean => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    return uuidRegex.test(id)
}

/**
 * Batch fetcher that combines concurrent revision requests into a single API call
 * Returns a function that can be called with a RevisionRequest
 */
const revisionBatchFetcher = createBatchFetcher<RevisionRequest, Revision | null>({
    maxBatchSize: 50,
    flushDelay: 10,
    serializeKey: (req: RevisionRequest) => `${req.projectId}:${req.revisionId}`,
    batchFn: async (requests: RevisionRequest[], serializedKeys: string[]) => {
        const results = new Map<string, Revision | null>()

        // Group by projectId (should all be same in practice)
        const byProject = new Map<string, string[]>()
        requests.forEach((req, index) => {
            const key = serializedKeys[index]
            // Skip invalid UUIDs
            if (!isValidUUID(req.revisionId)) {
                results.set(key, null)
                return
            }
            const existing = byProject.get(req.projectId) || []
            existing.push(req.revisionId)
            byProject.set(req.projectId, existing)
        })

        // Fetch each project's revisions
        for (const [projectId, revisionIds] of byProject) {
            if (revisionIds.length === 0) continue

            try {
                const requestBody = {
                    testset_revision_refs: revisionIds.map((id) => ({id})),
                    windowing: {limit: revisionIds.length},
                }
                const response = await axios.post(
                    `${getAgentaApiUrl()}/preview/testsets/revisions/query`,
                    requestBody,
                    {params: {project_id: projectId, include_testcases: false}},
                )

                const revisions = response.data?.testset_revisions ?? []
                const byId = new Map<string, Revision>()

                revisions.forEach((raw: unknown) => {
                    try {
                        const revision = normalizeRevision(raw)
                        byId.set(revision.id, revision)
                    } catch (e) {
                        console.error(
                            "[revisionBatchFetcher] Failed to normalize revision:",
                            e,
                            raw,
                        )
                    }
                })

                // Map results back to request keys
                revisionIds.forEach((id) => {
                    const key = `${projectId}:${id}`
                    const result = byId.get(id) ?? null
                    results.set(key, result)
                })
            } catch (_error) {
                // Set null for all failed requests
                revisionIds.forEach((id) => {
                    const key = `${projectId}:${id}`
                    results.set(key, null)
                })
            }
        }

        return results
    },
})

// ============================================================================
// REVISION DRAFT ATOMS
// Local edits to revision metadata before creating new revision
// ============================================================================

/**
 * Draft state for a revision (local edits)
 * Stores metadata that can be edited: message (commit message)
 */
export const revisionDraftAtomFamily = atomFamily(
    (_revisionId: string) => atom<Partial<Revision> | null>(null),
    (a, b) => a === b,
)

/**
 * Check if a revision has local draft edits
 */
export const revisionHasDraftAtomFamily = atomFamily(
    (revisionId: string) =>
        atom((get) => {
            const draft = get(revisionDraftAtomFamily(revisionId))
            return draft !== null
        }),
    (a, b) => a === b,
)

/**
 * Clear draft for a revision
 */
export const clearRevisionDraftAtom = atom(null, (get, set, revisionId: string) => {
    set(revisionDraftAtomFamily(revisionId), null)
})

/**
 * Clear all revision drafts
 */
export const clearAllRevisionDraftsAtom = atom(null, (get, set) => {
    const ids = get(revisionIdsAtom)
    ids.forEach((id) => {
        set(revisionDraftAtomFamily(id), null)
    })
})

// ============================================================================
// REVISION QUERY ATOM FAMILY
// Fetches individual revision data with batch optimization
// ============================================================================

/**
 * Query atom for fetching a single revision
 * Uses batch fetcher to combine concurrent requests
 */
export const revisionQueryAtomFamily = atomFamily(
    (revisionId: string) =>
        atomWithQuery<Revision | null>((get) => {
            const projectId = get(projectIdAtom)

            return {
                queryKey: ["revision", projectId, revisionId],
                queryFn: async () => {
                    if (!projectId || !revisionId || !isValidUUID(revisionId)) {
                        return null
                    }
                    const result = await revisionBatchFetcher({projectId, revisionId})
                    return result
                },
                enabled: Boolean(projectId && revisionId && isValidUUID(revisionId)),
                // Revisions are immutable - never stale, never gc
                staleTime: Infinity,
                gcTime: Infinity,
            }
        }),
    (a, b) => a === b,
)

// ============================================================================
// REVISION ENTITY ATOM FAMILY
// Combines server data with local draft (draft takes precedence)
// ============================================================================

/**
 * Get revision entity (server data merged with draft)
 *
 * Note: This uses the batch fetcher which efficiently combines concurrent requests.
 * The batch fetcher is shared across all revisionQueryAtomFamily instances,
 * so multiple concurrent calls will be automatically batched into a single API request.
 *
 * For revisions, draft state is simple (Partial<Revision>) because:
 * - Revisions are immutable - edits create new revisions
 * - Draft just holds temporary metadata (commit message) before save
 */
export const revisionEntityAtomFamily = atomFamily(
    (revisionId: string) =>
        atom((get) => {
            // Query is single source of truth for server data
            const query = get(revisionQueryAtomFamily(revisionId))
            const serverData = query.data ?? null

            if (!serverData) {
                return null
            }

            // Check for local draft
            const draft = get(revisionDraftAtomFamily(revisionId))
            if (draft) {
                return {...serverData, ...draft}
            }

            return serverData
        }),
    (a, b) => a === b,
)

// ============================================================================
// REVISIONS LIST QUERY
// Fetches all revisions for a testset
// ============================================================================

/**
 * Track which testsets have had their revisions list requested (for lazy loading)
 */
const revisionsListRequestedAtom = atom<Set<string>>(new Set<string>())

/**
 * Enable revisions list query for a testset (triggers fetch on first call)
 */
export const enableRevisionsListQueryAtom = atom(null, (get, set, testsetId: string) => {
    const requested = new Set(get(revisionsListRequestedAtom))
    requested.add(testsetId)
    set(revisionsListRequestedAtom, requested)
})

/**
 * Query atom for fetching revisions list for a testset
 * Lazy-loaded: only fetches when enableRevisionsListQueryAtom is called
 */
export const revisionsListQueryAtomFamily = atomFamily(
    (testsetId: string) =>
        atomWithQuery<RevisionListItem[]>((get) => {
            const projectId = get(projectIdAtom)
            const requested = get(revisionsListRequestedAtom)
            const isEnabled = requested.has(testsetId)

            return {
                queryKey: ["revisions-list", projectId, testsetId],
                queryFn: async () => {
                    if (!projectId || !testsetId) return []

                    const response = await axios.post(
                        `${getAgentaApiUrl()}/preview/testsets/revisions/query`,
                        {
                            testset_refs: [{id: testsetId}],
                            windowing: {limit: 100, order: "descending"},
                            include_testcases: false,
                        },
                        {params: {project_id: projectId}},
                    )

                    const revisions = response.data?.testset_revisions ?? []
                    // Strip out data.testcases to reduce payload size until backend is updated
                    return revisions.map((raw: any) => {
                        // Remove the data field which contains testcases array
                        const {data: _data, ...rest} = raw
                        return {
                            id: rest.id,
                            data: _data,
                            version:
                                typeof rest.version === "string"
                                    ? parseInt(rest.version, 10)
                                    : rest.version !== null && rest.version !== undefined
                                      ? rest.version
                                      : 0,
                            created_at: rest.created_at ?? rest.date ?? rest.commit?.date,
                            message: rest.message ?? rest.commit_message ?? rest.commit?.message,
                            author:
                                rest.author ??
                                rest.created_by_id ??
                                rest.commit?.author_id ??
                                rest.commit?.author?.id ??
                                null,
                        }
                    })
                },
                enabled: Boolean(projectId && testsetId && isEnabled),
                // Revisions list can change when new revisions are created
                staleTime: 30_000,
            }
        }),
    (a, b) => a === b,
)

/**
 * Derived atom that gets the latest revision from the revisions list query.
 * Returns the latest non-v0 revision, or v0 if that's all there is.
 * This is a simpler alternative to the batch-fetching latestRevisionAtomFamily.
 */
export const latestRevisionForTestsetAtomFamily = atomFamily(
    (testsetId: string) =>
        atom((get) => {
            const query = get(revisionsListQueryAtomFamily(testsetId))
            const revisions = query.data ?? []
            // Revisions are sorted descending by version, first non-v0 is latest
            const nonV0 = revisions.find((r) => r.version > 0)
            return nonV0 ?? revisions[0] ?? null
        }),
    (a, b) => a === b,
)

// ============================================================================
// LATEST REVISION ATOMS (LEGACY - batch fetching pattern)
// For testsets list - shows latest revision info per testset
// ============================================================================

/**
 * Latest revision info for display in testsets list
 */
export interface LatestRevisionInfo {
    revisionId: string
    version: number
    message?: string
    createdAt?: string
    author?: string
}

/**
 * Cache for latest revision info by testset ID
 */
const latestRevisionCacheAtom = atom<Map<string, LatestRevisionInfo>>(new Map())

/**
 * Pending batch of testset IDs to fetch latest revisions for
 */
const pendingLatestRevisionBatchAtom = atom<Set<string>>(new Set<string>())

/**
 * Flag to track if batch fetch is in progress
 */
const isFetchingLatestRevisionsAtom = atom(false)

// Debounce timer
let latestRevisionBatchTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Fetch latest revisions for multiple testsets in batch
 */
async function fetchLatestRevisionsBatch(
    projectId: string,
    testsetIds: string[],
): Promise<Map<string, LatestRevisionInfo>> {
    const result = new Map<string, LatestRevisionInfo>()

    if (!projectId || testsetIds.length === 0) return result

    // Filter out invalid testset IDs (e.g., "new" for unsaved testsets)
    const validTestsetIds = testsetIds.filter((id) => id && isValidUUID(id))
    if (validTestsetIds.length === 0) return result

    try {
        const response = await axios.post(
            `${getAgentaApiUrl()}/preview/testsets/revisions/query`,
            {
                testset_refs: validTestsetIds.map((id) => ({id})),
                windowing: {limit: validTestsetIds.length * 5, order: "descending"},
                include_testcases: false,
            },
            {params: {project_id: projectId}},
        )

        const revisions = response.data?.testset_revisions ?? []

        // Group by testset_id and get latest (highest version) for each
        const latestByTestset = new Map<string, any>()
        const v0ByTestset = new Map<string, any>()

        for (const revision of revisions) {
            const testsetId = revision.testset_id ?? revision.artifact_id
            if (!testsetId) continue

            const version =
                typeof revision.version === "string"
                    ? parseInt(revision.version, 10)
                    : (revision.version ?? 0)

            const isV0 = version === 0

            if (isV0) {
                v0ByTestset.set(testsetId, {...revision, version})
                continue
            }

            const existing = latestByTestset.get(testsetId)
            const existingVersion = existing?.version ?? -1

            if (version > existingVersion) {
                latestByTestset.set(testsetId, {...revision, version})
            }
        }

        // For testsets with only v0, use v0 as latest
        for (const [testsetId, v0Revision] of v0ByTestset) {
            if (!latestByTestset.has(testsetId)) {
                latestByTestset.set(testsetId, v0Revision)
            }
        }

        // Convert to LatestRevisionInfo
        for (const [testsetId, revision] of latestByTestset) {
            result.set(testsetId, {
                revisionId: revision.id,
                version: revision.version,
                message: revision.message,
                createdAt: revision.created_at,
                author: revision.author ?? revision.created_by_id,
            })
        }
    } catch (error) {
        // Return empty map on error
    }

    return result
}

/**
 * Request latest revision for a testset ID
 * Batches requests and fetches in bulk after short debounce
 */
export const requestLatestRevisionAtom = atom(null, (get, set, testsetId: string) => {
    const projectId = get(projectIdAtom)
    if (!projectId) return

    // Check if already cached
    const cache = get(latestRevisionCacheAtom)
    if (cache.has(testsetId)) return

    // Add to pending batch
    const pending = new Set(get(pendingLatestRevisionBatchAtom))
    pending.add(testsetId)
    set(pendingLatestRevisionBatchAtom, pending)

    // Debounce batch fetch
    if (latestRevisionBatchTimer) {
        clearTimeout(latestRevisionBatchTimer)
    }

    latestRevisionBatchTimer = setTimeout(async () => {
        const isFetching = get(isFetchingLatestRevisionsAtom)
        if (isFetching) return

        const pendingIds = Array.from(get(pendingLatestRevisionBatchAtom))
        if (pendingIds.length === 0) return

        // Clear pending and mark as fetching
        set(pendingLatestRevisionBatchAtom, new Set())
        set(isFetchingLatestRevisionsAtom, true)

        try {
            const results = await fetchLatestRevisionsBatch(projectId, pendingIds)

            // Merge results into cache
            const currentCache = new Map(get(latestRevisionCacheAtom))
            for (const [id, info] of results) {
                currentCache.set(id, info)
            }
            set(latestRevisionCacheAtom, currentCache)
        } finally {
            set(isFetchingLatestRevisionsAtom, false)
        }
    }, 50)
})

/**
 * Get latest revision info for a testset (read-only)
 */
export const latestRevisionAtomFamily = atomFamily(
    (testsetId: string) =>
        atom((get) => {
            const cache = get(latestRevisionCacheAtom)
            return cache.get(testsetId) ?? null
        }),
    (a, b) => a === b,
)

/**
 * Stateful atom family for latest revision with loading state.
 * Use this when you need to show loading indicators in cells.
 *
 * @returns {data, isPending} where isPending is true while fetching
 */
export const latestRevisionStatefulAtomFamily = atomFamily(
    (testsetId: string) =>
        atom((get) => {
            const cache = get(latestRevisionCacheAtom)
            const data = cache.get(testsetId) ?? null

            // Check if this testset is pending fetch or if a fetch is in progress
            const pending = get(pendingLatestRevisionBatchAtom)
            const isFetching = get(isFetchingLatestRevisionsAtom)

            // isPending if: in pending batch, or fetching is in progress and not yet cached
            const isPending = pending.has(testsetId) || (isFetching && !data)

            return {data, isPending}
        }),
    (a, b) => a === b,
)

/**
 * Clear latest revision cache
 */
export const clearLatestRevisionCacheAtom = atom(null, (get, set) => {
    set(latestRevisionCacheAtom, new Map())
})

// ============================================================================
// UPDATE REVISION ATOM
// For updating revision metadata locally (before commit)
// ============================================================================

/**
 * Update revision draft with partial data
 */
export const updateRevisionDraftAtom = atom(
    null,
    (get, set, {revisionId, updates}: {revisionId: string; updates: Partial<Revision>}) => {
        const currentDraft = get(revisionDraftAtomFamily(revisionId))
        set(revisionDraftAtomFamily(revisionId), {
            ...currentDraft,
            ...updates,
        })
    },
)

// ============================================================================
// REVISION DIRTY STATE
// Check if revision has unsaved local changes
// ============================================================================

/**
 * Check if a revision has unsaved changes (draft differs from server)
 */
export const revisionIsDirtyAtomFamily = atomFamily(
    (revisionId: string) =>
        atom((get) => {
            const draft = get(revisionDraftAtomFamily(revisionId))
            return draft !== null
        }),
    (a, b) => a === b,
)
