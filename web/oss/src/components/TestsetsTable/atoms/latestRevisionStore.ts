import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {getProjectValues} from "@/oss/state/project"

/**
 * Latest revision info for a testset
 */
export interface LatestRevisionInfo {
    revisionId: string
    version: string
    message?: string
    createdAt: string
    createdById?: string
}

// Store for latest revision data by testset ID
const latestRevisionCacheAtom = atom<Map<string, LatestRevisionInfo>>(new Map())

// Pending batch of testset IDs to fetch
const pendingBatchAtom = atom<Set<string>>(new Set())

// Flag to track if a batch fetch is in progress
const isFetchingAtom = atom(false)

// Debounce timer ID
let batchDebounceTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Fetch latest revisions for multiple testsets in a single batch request
 */
const fetchLatestRevisionsBatch = async (
    testsetIds: string[],
): Promise<Map<string, LatestRevisionInfo>> => {
    const {projectId} = getProjectValues()
    const result = new Map<string, LatestRevisionInfo>()

    if (!projectId || testsetIds.length === 0) {
        return result
    }

    try {
        const response = await axios.post(
            `${getAgentaApiUrl()}/preview/testsets/revisions/query`,
            {
                testset_refs: testsetIds.map((id) => ({id})),
                windowing: {
                    limit: testsetIds.length * 5,
                    order: "descending",
                },
            },
            {
                params: {project_id: projectId},
            },
        )

        const revisions = response.data?.testset_revisions ?? []

        // Group by testset_id and get the latest (highest version) for each
        // Also track v0 revisions separately in case they're the only ones
        const latestByTestset = new Map<string, any>()
        const v0ByTestset = new Map<string, any>()

        for (const revision of revisions) {
            const testsetId = revision.testset_id ?? revision.artifact_id
            if (!testsetId) continue

            const isV0 = revision.version === "0" || String(revision.version) === "0"

            if (isV0) {
                // Track v0 separately
                v0ByTestset.set(testsetId, revision)
                continue
            }

            const existing = latestByTestset.get(testsetId)
            const currentVersion = parseInt(String(revision.version), 10)
            const existingVersion = existing ? parseInt(String(existing.version), 10) : -1

            if (currentVersion > existingVersion) {
                latestByTestset.set(testsetId, revision)
            }
        }

        // For testsets with only v0, use v0 as the latest
        for (const [testsetId, v0Revision] of v0ByTestset) {
            if (!latestByTestset.has(testsetId)) {
                latestByTestset.set(testsetId, v0Revision)
            }
        }

        // Convert to LatestRevisionInfo
        for (const [testsetId, revision] of latestByTestset) {
            result.set(testsetId, {
                revisionId: revision.id,
                version: String(revision.version),
                message: revision.message,
                createdAt: revision.created_at,
                createdById: revision.created_by_id,
            })
        }
    } catch (error) {
        console.error("[LatestRevisionStore] Failed to fetch batch:", error)
    }

    return result
}

/**
 * Request latest revision for a testset ID.
 * Batches requests and fetches in bulk after a short debounce.
 */
export const requestLatestRevisionAtom = atom(null, (get, set, testsetId: string) => {
    // Check if already cached
    const cache = get(latestRevisionCacheAtom)
    if (cache.has(testsetId)) {
        return
    }

    // Add to pending batch
    const pending = new Set(get(pendingBatchAtom))
    pending.add(testsetId)
    set(pendingBatchAtom, pending)

    // Debounce the batch fetch
    if (batchDebounceTimer) {
        clearTimeout(batchDebounceTimer)
    }

    batchDebounceTimer = setTimeout(async () => {
        const isFetching = get(isFetchingAtom)
        if (isFetching) return

        const pendingIds = Array.from(get(pendingBatchAtom))
        if (pendingIds.length === 0) return

        // Clear pending and mark as fetching
        set(pendingBatchAtom, new Set())
        set(isFetchingAtom, true)

        try {
            const results = await fetchLatestRevisionsBatch(pendingIds)

            // Merge results into cache
            const currentCache = new Map(get(latestRevisionCacheAtom))
            for (const [id, info] of results) {
                currentCache.set(id, info)
            }
            set(latestRevisionCacheAtom, currentCache)
        } finally {
            set(isFetchingAtom, false)
        }
    }, 50) // 50ms debounce to batch requests
})

/**
 * Get latest revision info for a testset ID (read-only)
 */
export const latestRevisionAtomFamily = atomFamily((testsetId: string) =>
    atom((get) => {
        const cache = get(latestRevisionCacheAtom)
        return cache.get(testsetId) ?? null
    }),
)

/**
 * Clear the cache (e.g., on refresh)
 */
export const clearLatestRevisionCacheAtom = atom(null, (_get, set) => {
    set(latestRevisionCacheAtom, new Map())
})
