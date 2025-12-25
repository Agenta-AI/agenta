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
                const response = await axios.post(
                    `${getAgentaApiUrl()}/preview/testsets/revisions/query`,
                    {
                        revision_ids: revisionIds,
                        windowing: {limit: revisionIds.length},
                    },
                    {params: {project_id: projectId}},
                )

                const revisions = response.data?.testset_revisions ?? []
                const byId = new Map<string, Revision>()

                revisions.forEach((raw: unknown) => {
                    try {
                        const revision = normalizeRevision(raw)
                        byId.set(revision.id, revision)
                    } catch (_e) {
                        // Skip invalid revisions
                    }
                })

                // Map results back to request keys
                revisionIds.forEach((id) => {
                    const key = `${projectId}:${id}`
                    results.set(key, byId.get(id) ?? null)
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
                    return revisionBatchFetcher({projectId, revisionId})
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
 */
export const revisionEntityAtomFamily = atomFamily(
    (revisionId: string) =>
        atom((get) => {
            const queryAtom = revisionQueryAtomFamily(revisionId)
            const query = get(queryAtom)
            const serverData = query.data

            if (!serverData) return null

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
 * Query atom for fetching revisions list for a testset
 */
export const revisionsListQueryAtomFamily = atomFamily(
    (testsetId: string) =>
        atomWithQuery<RevisionListItem[]>((get) => {
            const projectId = get(projectIdAtom)

            return {
                queryKey: ["revisions-list", projectId, testsetId],
                queryFn: async () => {
                    if (!projectId || !testsetId) return []

                    const response = await axios.post(
                        `${getAgentaApiUrl()}/preview/testsets/revisions/query`,
                        {
                            testset_refs: [{id: testsetId}],
                            windowing: {limit: 100, order: "descending"},
                        },
                        {params: {project_id: projectId}},
                    )

                    const revisions = response.data?.testset_revisions ?? []
                    return revisions.map((raw: any) => ({
                        id: raw.id,
                        version:
                            typeof raw.version === "string"
                                ? parseInt(raw.version, 10)
                                : raw.version !== null && raw.version !== undefined
                                  ? raw.version
                                  : 0,
                        created_at: raw.created_at ?? raw.date ?? raw.commit?.date,
                        message: raw.message ?? raw.commit_message ?? raw.commit?.message,
                        author:
                            raw.author ??
                            raw.created_by_id ??
                            raw.commit?.author_id ??
                            raw.commit?.author?.id ??
                            null,
                    }))
                },
                enabled: Boolean(projectId && testsetId),
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
const pendingLatestRevisionBatchAtom = atom<Set<string>>(new Set())

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

    try {
        const response = await axios.post(
            `${getAgentaApiUrl()}/preview/testsets/revisions/query`,
            {
                testset_refs: testsetIds.map((id) => ({id})),
                windowing: {limit: testsetIds.length * 5, order: "descending"},
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
