/**
 * Testcases Table Store
 *
 * This module provides table-specific state management for the TestcasesTableNew component.
 * It uses the entity paginated store from @/oss/state/entities/testcase for core pagination.
 *
 * ## Architecture
 *
 * - Core pagination: Uses `testcase.paginated.store` from entity module
 * - Table-specific: Revision change effects, row ID sync, initial fetch tracking
 *
 * ## Migration Note
 *
 * The common pagination atoms are now available via:
 *
 * ```typescript
 * import { testcase } from '@/oss/state/entities/testcase'
 *
 * // Option 1: Use with useTableManager (recommended for InfiniteVirtualTable)
 * const table = useTableManager({
 *   datasetStore: testcase.paginated.store,
 *   scopeId: `testcases-${revisionId}`,
 *   pageSize: 50,
 * })
 *
 * // Option 2: Use controller for fine-grained atom access
 * const [state, dispatch] = useAtom(testcase.paginated.controller({
 *   scopeId: `testcases-${revisionId}`,
 *   pageSize: 50,
 * }))
 * // state.rows, state.isFetching, state.hasMore, state.selectedKeys
 * // dispatch({ type: 'refresh' }), dispatch({ type: 'select', keys: [...] })
 *
 * // Option 3: Use individual selectors for minimal re-renders
 * const rows = useAtomValue(testcase.paginated.selectors.rows({scopeId, pageSize}))
 * const pagination = useAtomValue(testcase.paginated.selectors.pagination({scopeId, pageSize}))
 *
 * // Filter atoms
 * testcase.filters.revisionId     // Current revision ID
 * testcase.filters.searchTerm     // Immediate search term (for UI)
 * testcase.filters.setSearchTerm  // Debounced search setter
 *
 * // Refresh
 * const refresh = useSetAtom(testcase.paginated.actions.refresh)
 * refresh()
 * ```
 *
 * @see @/oss/state/entities/testcase for the canonical entity API
 */

import {atom} from "jotai"

import {cleanupOnRevisionChangeAtom} from "@/oss/state/entities/testcase/atomCleanup"
import {
    clearPendingAddedColumnsAtom,
    clearPendingDeletedColumnsAtom,
    clearPendingRenamesAtom,
    resetColumnsAtom,
} from "@/oss/state/entities/testcase/columnState"
import {
    setDebouncedSearchTermAtom as setDebouncedSearchTermAtomFromEntity,
    testcase,
    testcasePaginatedStore,
    testcasesPaginatedMetaAtom,
    testcasesRevisionIdAtom as testcasesRevisionIdAtomFromEntity,
    testcasesSearchTermAtom as testcasesSearchTermAtomFromEntity,
    TESTCASES_PAGE_SIZE as PAGE_SIZE,
    type TestcasePaginatedMeta,
    type TestcaseTableRow,
} from "@/oss/state/entities/testcase"
import {setTestcaseIdsAtom} from "@/oss/state/entities/testcase/testcaseEntity"

// ============================================================================
// RE-EXPORTS FROM ENTITY MODULE
// These are the canonical locations for pagination state
// ============================================================================

/**
 * @deprecated Import from `testcase.filters.revisionId` or `@/oss/state/entities/testcase` instead
 */
export const testcasesRevisionIdAtom = testcasesRevisionIdAtomFromEntity

/**
 * @deprecated Import from `testcase.filters.searchTerm` or `@/oss/state/entities/testcase` instead
 */
export const testcasesSearchTermAtom = testcasesSearchTermAtomFromEntity

/**
 * @deprecated Import from `testcase.filters.setSearchTerm` or `@/oss/state/entities/testcase` instead
 */
export const setDebouncedSearchTermAtom = setDebouncedSearchTermAtomFromEntity

/**
 * @deprecated Import from `testcase.paginated.store` or `@/oss/state/entities/testcase` instead
 */
export const testcasesDatasetStore = testcase.paginated.store

/**
 * @deprecated Import from `testcase.paginated.metaAtom` or `@/oss/state/entities/testcase` instead
 */
export const testcasesTableMetaAtom = testcasesPaginatedMetaAtom

/**
 * @deprecated Import from `testcase.paginated.refreshAtom` or `@/oss/state/entities/testcase` instead
 */
export const testcasesRefreshTriggerAtom = testcase.paginated.refreshAtom

// Re-export types for backward compatibility
export type {TestcasePaginatedMeta as TestcaseTableMeta, TestcaseTableRow}

/**
 * API response from /preview/testsets/{testset_id}
 */
export interface TestcaseRevisionResponse {
    id: string // revision ID
    testset_id: string
    parent_testset_id?: string | null
    version?: number
    testcases: {
        id: string
        testset_id: string
        created_at: string
        data: Record<string, unknown>
    }[]
}

// ============================================================================
// TABLE-SPECIFIC STATE
// Initial fetch completion tracking (for triggering initialization)
// ============================================================================

/**
 * Atom to signal when initial fetch completes for a revision
 * Maps revisionId -> true when first fetch completes
 */
const initialFetchCompletedMapAtom = atom<Record<string, boolean>>({})

/**
 * Mark a specific revision's initial fetch as completed
 */
export const markInitialFetchCompletedAtom = atom(null, (_get, set, revisionId: string) => {
    set(initialFetchCompletedMapAtom, (prev) => ({...prev, [revisionId]: true}))
})

/**
 * Check if the current revision's initial fetch has completed
 */
export const hasInitialFetchCompletedAtom = atom((get) => {
    const revisionId = get(testcasesRevisionIdAtom)
    if (!revisionId) return false
    const map = get(initialFetchCompletedMapAtom)
    return map[revisionId] ?? false
})

/**
 * Atom that reads the table query fetching state from the paginated store
 * Returns true when the query is currently fetching data
 *
 * @deprecated Use `testcase.selectors.isFetching` instead (imported from entity module)
 *
 * @example
 * ```typescript
 * // Preferred: Use the controller selector
 * const isFetching = useAtomValue(testcase.selectors.isFetching)
 *
 * // Or with controller pattern
 * const params = { scopeId: `testcases-${revisionId}`, pageSize: PAGE_SIZE }
 * const { isFetching } = useAtomValue(testcase.paginated.selectors.pagination(params))
 * ```
 */
export const tableQueryFetchingAtom = atom((get) => {
    const meta = get(testcasesPaginatedMetaAtom)
    if (!meta.revisionId) return false

    const scopeId = `testcases-${meta.revisionId}`
    const paginationAtom = testcasePaginatedStore.store.atoms.paginationAtom({
        scopeId,
        pageSize: PAGE_SIZE,
    })
    const pagination = get(paginationAtom)

    return pagination.isFetching
})

// ============================================================================
// ROWS TO ENTITY IDS SYNC
// Watches paginated store rows and hydrates testcaseIdsAtom when data arrives
// ============================================================================

/**
 * Derived atom that extracts SERVER IDs from the paginated store's rows
 * This runs AFTER the query settles and data is in the cache
 * Excludes client-created rows (new rows) - those are tracked in newEntityIdsAtom
 *
 * NOTE: This uses the store's rowsAtom directly because it needs to compute
 * scopeId dynamically from meta. For components with known scopeId, prefer:
 *
 * @example
 * ```typescript
 * // In components with known scopeId
 * const rows = useAtomValue(testcase.paginated.selectors.rows({
 *   scopeId: `testcases-${revisionId}`,
 *   pageSize: PAGE_SIZE,
 * }))
 * const serverIds = rows.filter(r => !r.__isSkeleton && !r.__isNew).map(r => r.id)
 * ```
 */
export const testcaseRowIdsAtom = atom((get) => {
    const meta = get(testcasesPaginatedMetaAtom)
    if (!meta.revisionId) return []

    const scopeId = `testcases-${meta.revisionId}`
    const rowsAtom = testcasePaginatedStore.store.atoms.rowsAtom({scopeId, pageSize: PAGE_SIZE})
    const rows = get(rowsAtom)

    // Filter out skeleton rows, new rows (client-created), and extract IDs
    // New rows have __isNew flag or IDs starting with "new-"
    const ids = rows
        .filter((row) => {
            if (row.__isSkeleton) return false
            if (row.__isNew) return false
            if (!row.id) return false
            if (typeof row.id === "string" && row.id.startsWith("new-")) return false
            return true
        })
        .map((row) => row.id as string)

    return ids
})

/**
 * Atom that provides a map of testcase ID to row data from the paginated store
 * Used for operations that need to access row data directly (e.g., column rename)
 *
 * NOTE: This uses the store's rowsAtom directly because it needs to compute
 * scopeId dynamically from meta. For components with known scopeId, prefer:
 *
 * @example
 * ```typescript
 * // In components with known scopeId
 * const rows = useAtomValue(testcase.paginated.selectors.rows({
 *   scopeId: `testcases-${revisionId}`,
 *   pageSize: PAGE_SIZE,
 * }))
 * const rowDataMap = new Map(rows.filter(r => r.id).map(r => [r.id, r]))
 * ```
 */
export const testcaseRowDataMapAtom = atom((get) => {
    const meta = get(testcasesPaginatedMetaAtom)
    if (!meta.revisionId) return new Map<string, TestcaseTableRow>()

    const scopeId = `testcases-${meta.revisionId}`
    const rowsAtom = testcasePaginatedStore.store.atoms.rowsAtom({scopeId, pageSize: PAGE_SIZE})
    const rows = get(rowsAtom)

    const map = new Map<string, TestcaseTableRow>()
    for (const row of rows) {
        if (row.__isSkeleton) continue
        if (!row.id) continue
        map.set(row.id as string, row)
    }

    return map
})

/**
 * Effect atom that syncs row IDs to testcaseIdsAtom
 * Call this from a useEffect or atomEffect to keep entity atoms in sync
 */
export const syncRowIdsToEntityAtom = atom(null, (get, set) => {
    const ids = get(testcaseRowIdsAtom)
    if (ids.length > 0) {
        set(setTestcaseIdsAtom, ids)
    }
})

/**
 * Effect atom that marks initial fetch as completed for the current revision
 * This should be called after the first data sync to signal that we can now initialize placeholders
 */
export const markFetchCompletedForRevisionAtom = atom(null, (get, set) => {
    const revisionId = get(testcasesRevisionIdAtom)
    if (revisionId) {
        set(markInitialFetchCompletedAtom, revisionId)
    }
})

// ============================================================================
// REVISION CHANGE EFFECT
// Consolidates all side effects when revision changes
// ============================================================================

/**
 * Track previous revision ID for detecting changes
 */
const previousRevisionIdAtom = atom<string | null>(null)

/**
 * Effect atom that runs all side effects when revision changes
 * - Sets the revision ID (single source of truth)
 * - Cleanup old testcase atoms (memory management)
 * - Reset column state and pending column changes
 *
 * Note: v0 initialization is handled separately in useTestcasesTable
 *
 * Use with atomEffect or call from a single useEffect in the component
 */
export const revisionChangeEffectAtom = atom(null, (get, set, newRevisionId: string | null) => {
    const previousRevisionId = get(previousRevisionIdAtom)

    // Always set the revision ID (this is the entry point from URL)
    set(testcasesRevisionIdAtom, newRevisionId)

    // Skip side effects if revision hasn't changed
    if (previousRevisionId === newRevisionId) return

    // Update tracked revision
    set(previousRevisionIdAtom, newRevisionId)

    // 1. Cleanup old testcase atoms (prevents memory leaks)
    set(cleanupOnRevisionChangeAtom, newRevisionId)

    // 2. Reset column state
    set(resetColumnsAtom)

    // 3. Clear pending column changes from previous revision
    set(clearPendingRenamesAtom)
    set(clearPendingDeletedColumnsAtom)
    set(clearPendingAddedColumnsAtom)

    // 4. Reset initial fetch completed flag for new revision
    set(initialFetchCompletedMapAtom, (prev) => {
        const updated = {...prev}
        if (newRevisionId) {
            delete updated[newRevisionId]
        }
        return updated
    })

    // 5. For "new" or "draft" revisions (client-only), immediately mark fetch as completed
    // These don't need real API fetches - the revisionQueryAtom returns mock data synchronously
    // Without this, the second time entering "new" mode, the cached query doesn't trigger
    // the fetching transition, so initialization never runs
    if (newRevisionId === "new" || newRevisionId === "draft") {
        set(markInitialFetchCompletedAtom, newRevisionId)
    }
})
