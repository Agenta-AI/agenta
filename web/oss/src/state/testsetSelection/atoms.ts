import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {
    fetchRevisionsList,
    latestRevisionForTestsetAtomFamily,
    type RevisionListItem,
} from "@/oss/state/entities/testset"
import {projectIdAtom} from "@/oss/state/project"

/**
 * Testset/Revision Selection State
 *
 * Shared atoms for testset and revision selection logic.
 * Used by both TestsetDrawer (cascader) and LoadTestsetModal (menu).
 *
 * Features:
 * - Testset selection with auto-latest-revision
 * - Revision fetching with caching
 * - Loading states per testset
 * - Reset functionality
 */

// ============================================================================
// SELECTION STATE ATOMS
// ============================================================================

/** Currently selected testset ID */
export const selectedTestsetIdAtom = atom<string>("")

/** Currently selected revision ID */
export const selectedRevisionIdAtom = atom<string>("")

/** Selected testset info (name and id) */
export const selectedTestsetInfoAtom = atom<{name: string; id: string}>({name: "", id: ""})

/** Is the current selection a "Create New" testset? */
export const isNewTestsetAtom = atom((get) => {
    const testsetInfo = get(selectedTestsetInfoAtom)
    return testsetInfo.id === "create"
})

// ============================================================================
// REVISIONS LOADING STATE
// ============================================================================

/** Loading state for revision fetching (global) */
export const loadingRevisionsAtom = atom<boolean>(false)

/** Loading state per testset - maps testsetId to loading boolean */
export const loadingTestsetMapAtom = atom<Map<string, boolean>>(new Map())

/** Loaded revisions cache - maps testsetId to revisions array */
export const loadedRevisionsMapAtom = atom<Map<string, RevisionListItem[]>>(new Map())

/** Available revisions for the selected testset (derived from cache) */
export const availableRevisionsAtom = atom<{id: string; version: number | null}[]>((get) => {
    const testsetId = get(selectedTestsetIdAtom)
    if (!testsetId) return []

    const cache = get(loadedRevisionsMapAtom)
    const revisions = cache.get(testsetId) || []

    return revisions.map((rev) => ({
        id: rev.id,
        version: rev.version != null ? Number(rev.version) : null,
    }))
})

/**
 * Write atom: Update revisions cache for a specific testset
 * Use this instead of trying to write to availableRevisionsAtom directly
 */
export const setRevisionsForTestsetAtom = atom(
    null,
    (get, set, {testsetId, revisions}: {testsetId: string; revisions: RevisionListItem[]}) => {
        const currentCache = get(loadedRevisionsMapAtom)
        const newCache = new Map(currentCache)
        newCache.set(testsetId, revisions)
        set(loadedRevisionsMapAtom, newCache)
    },
)

// ============================================================================
// REVISION LOADING ACTIONS
// ============================================================================

/**
 * Load revisions for a testset
 * Fetches from API and caches the result
 */
export const loadRevisionsForTestsetAtom = atom(
    null,
    async (get, set, testsetId: string): Promise<RevisionListItem[]> => {
        if (!testsetId || testsetId === "create") {
            return []
        }

        // Check cache first
        const cache = get(loadedRevisionsMapAtom)
        const cached = cache.get(testsetId)
        if (cached) {
            return cached
        }

        // Set loading state
        set(loadingRevisionsAtom, true)
        const currentLoading = get(loadingTestsetMapAtom)
        const newLoadingMap = new Map(currentLoading)
        newLoadingMap.set(testsetId, true)
        set(loadingTestsetMapAtom, newLoadingMap)

        try {
            const projectId = get(projectIdAtom)
            if (!projectId) {
                return []
            }
            const response = await fetchRevisionsList({projectId, testsetId})
            const revisions = response.testset_revisions

            // Update cache
            const currentCache = get(loadedRevisionsMapAtom)
            const newCache = new Map(currentCache)
            newCache.set(testsetId, revisions)
            set(loadedRevisionsMapAtom, newCache)

            // Clear loading state
            const updatedLoading = get(loadingTestsetMapAtom)
            const clearedLoadingMap = new Map(updatedLoading)
            clearedLoadingMap.set(testsetId, false)
            set(loadingTestsetMapAtom, clearedLoadingMap)

            return revisions
        } catch (error) {
            console.error("[loadRevisionsForTestsetAtom] Error:", error)

            // Clear loading state on error
            const updatedLoading = get(loadingTestsetMapAtom)
            const clearedLoadingMap = new Map(updatedLoading)
            clearedLoadingMap.set(testsetId, false)
            set(loadingTestsetMapAtom, clearedLoadingMap)

            return []
        } finally {
            set(loadingRevisionsAtom, false)
        }
    },
)

/**
 * Check if revisions are loading for a specific testset
 */
export const isLoadingRevisionsForTestsetAtomFamily = atomFamily((testsetId: string) =>
    atom((get) => {
        const loadingMap = get(loadingTestsetMapAtom)
        return loadingMap.get(testsetId) || false
    }),
)

/**
 * Get cached revisions for a specific testset
 */
export const cachedRevisionsForTestsetAtomFamily = atomFamily((testsetId: string) =>
    atom((get) => {
        const cache = get(loadedRevisionsMapAtom)
        return cache.get(testsetId) || []
    }),
)

// ============================================================================
// SELECTION ACTIONS
// ============================================================================

/**
 * Select a testset and auto-select its latest revision
 *
 * This is a reducer-style atom that:
 * 1. Updates selected testset ID
 * 2. Fetches revisions if not cached
 * 3. Auto-selects the latest revision
 */
export const selectTestsetAtom = atom(
    null,
    async (
        get,
        set,
        params: {
            testsetId: string
            testsetName?: string
            autoSelectLatest?: boolean
        },
    ) => {
        const {testsetId, testsetName = "", autoSelectLatest = true} = params

        // Update testset selection
        set(selectedTestsetIdAtom, testsetId)
        set(selectedTestsetInfoAtom, {id: testsetId, name: testsetName})

        // Clear revision selection initially
        set(selectedRevisionIdAtom, "")

        if (!testsetId || testsetId === "create") {
            return
        }

        // Load revisions (will use cache if available)
        const revisions = await set(loadRevisionsForTestsetAtom, testsetId)

        // Auto-select latest revision
        if (autoSelectLatest && revisions.length > 0) {
            // Try to get latest from query atom first (more reliable)
            const latestRevision = get(latestRevisionForTestsetAtomFamily(testsetId))
            const latestId = latestRevision?.id || revisions[0]?.id

            if (latestId) {
                set(selectedRevisionIdAtom, latestId)
            }
        }
    },
)

/**
 * Select a specific revision
 */
export const selectRevisionAtom = atom(null, (_get, set, revisionId: string) => {
    set(selectedRevisionIdAtom, revisionId)
})

/**
 * Reset all selection state
 */
export const resetSelectionAtom = atom(null, (_get, set) => {
    set(selectedTestsetIdAtom, "")
    set(selectedRevisionIdAtom, "")
    set(selectedTestsetInfoAtom, {name: "", id: ""})
    // Note: We don't clear the cache - it can be reused
})

/**
 * Clear revisions cache (useful when testsets are modified)
 */
export const clearRevisionsCacheAtom = atom(null, (_get, set) => {
    set(loadedRevisionsMapAtom, new Map())
    set(loadingTestsetMapAtom, new Map())
})
