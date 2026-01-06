/**
 * Testset Entity Controller
 *
 * Provides a unified, simplified API for working with testset entities.
 * Follows the same pattern as revision/testcase controllers for consistency.
 *
 * ## Usage
 *
 * ```typescript
 * import { testset } from '@/state/entities/testset'
 *
 * // List query (subscribe to testsets list)
 * const testsetsQuery = useAtomValue(testset.queries.list(null)) // null = no search
 * const testsetsQuery = useAtomValue(testset.queries.list('my-search'))
 *
 * // Detail query (subscribe to single testset)
 * const testsetQuery = useAtomValue(testset.queries.detail(testsetId))
 *
 * // Paginated query (for InfiniteVirtualTable)
 * const {rows, loadNextPage} = useInfiniteTablePagination({
 *   store: testset.paginated.store,
 *   scopeId: projectId,
 *   pageSize: 50,
 * })
 *
 * // Invalidate cache (after create/update/delete)
 * testset.invalidate.list()
 * testset.invalidate.detail(testsetId)
 *
 * // Direct entity access (from cache)
 * const testsetData = useAtomValue(testset.selectors.data(testsetId))
 * const testsetQuery = useAtomValue(testset.selectors.query(testsetId))
 * ```
 */

import {
    testsetPaginatedStore,
    testsetsSearchTermAtom,
    testsetsDateCreatedFilterAtom,
    testsetsDateModifiedFilterAtom,
    testsetsExportFormatAtom,
} from "./paginatedStore"
import {
    discardTestsetDraftAtom,
    invalidateTestsetCache,
    invalidateTestsetsListCache,
    testsetEntityAtomFamily,
    testsetHasDraftAtomFamily,
    testsetIsDirtyAtomFamily,
    testsetQueryAtomFamily,
    testsetServerDataAtomFamily,
    testsetsListQueryAtomFamily,
    updateTestsetDraftAtom,
} from "./store"

// ============================================================================
// UNIFIED TESTSET API
// ============================================================================

/**
 * Testset entity API
 *
 * Provides queries, selectors, and cache invalidation for testset entities.
 *
 * @example
 * ```typescript
 * // List query in components
 * const testsetsQuery = useAtomValue(testset.queries.list(null))
 * const testsets = testsetsQuery.data?.testsets ?? []
 * const isLoading = testsetsQuery.isLoading
 *
 * // Detail query
 * const query = useAtomValue(testset.queries.detail(testsetId))
 *
 * // Entity selectors (from cache)
 * const data = useAtomValue(testset.selectors.data(testsetId))
 *
 * // Cache invalidation (after mutations)
 * testset.invalidate.list()
 * testset.invalidate.detail(testsetId)
 * ```
 */
export const testset = {
    /**
     * Query atoms for data fetching
     */
    queries: {
        /**
         * List query: fetch testsets list
         * @param searchQuery - Optional search string (null for no filter)
         *
         * @example
         * ```typescript
         * const query = useAtomValue(testset.queries.list(null))
         * const testsets = query.data?.testsets ?? []
         * ```
         */
        list: testsetsListQueryAtomFamily,

        /**
         * Detail query: fetch single testset
         * @param testsetId - The testset ID
         *
         * @example
         * ```typescript
         * const query = useAtomValue(testset.queries.detail(testsetId))
         * const testset = query.data
         * ```
         */
        detail: testsetQueryAtomFamily,
    },

    /**
     * Fine-grained selectors for entity access
     */
    selectors: {
        /**
         * Entity data (server + draft merged)
         * Use this for displaying current state to user
         * @param testsetId - The testset ID
         */
        data: testsetEntityAtomFamily,

        /**
         * Server data only (without draft)
         * Use this when you need the original server state
         * @param testsetId - The testset ID
         */
        serverData: testsetServerDataAtomFamily,

        /**
         * Query state - single source of truth (data, isPending, isError, error)
         * @param testsetId - The testset ID
         */
        query: testsetQueryAtomFamily,

        /**
         * Check if testset has local draft edits
         * @param testsetId - The testset ID
         */
        hasDraft: testsetHasDraftAtomFamily,

        /**
         * Check if testset is dirty (draft differs from server)
         * @param testsetId - The testset ID
         */
        isDirty: testsetIsDirtyAtomFamily,
    },

    /**
     * Actions for modifying testset state
     */
    actions: {
        /**
         * Update testset metadata (name, description)
         * Creates/updates local draft
         *
         * @example
         * ```typescript
         * const updateMetadata = useSetAtom(testset.actions.updateMetadata)
         * updateMetadata(testsetId, { name: 'New Name' })
         * ```
         */
        updateMetadata: updateTestsetDraftAtom,

        /**
         * Discard local draft for a testset
         *
         * @example
         * ```typescript
         * const discardDraft = useSetAtom(testset.actions.discardDraft)
         * discardDraft(testsetId)
         * ```
         */
        discardDraft: discardTestsetDraftAtom,
    },

    /**
     * Cache invalidation helpers
     * Call these after mutations to refresh data
     */
    invalidate: {
        /**
         * Invalidate testsets list cache
         * Call after creating/deleting a testset
         */
        list: invalidateTestsetsListCache,

        /**
         * Invalidate specific testset cache
         * Call after updating testset metadata
         * @param testsetId - The testset ID to invalidate
         */
        detail: invalidateTestsetCache,
    },

    /**
     * Paginated store for InfiniteVirtualTable
     * Use for large lists with cursor-based pagination
     *
     * @example
     * ```typescript
     * const {rows, loadNextPage} = useInfiniteTablePagination({
     *   store: testset.paginated.store,
     *   scopeId: projectId,
     *   pageSize: 50,
     * })
     *
     * // Refresh after mutations
     * const refresh = useSetAtom(testset.paginated.refreshAtom)
     * refresh()
     * ```
     */
    paginated: testsetPaginatedStore,

    /**
     * Filter atoms for paginated queries
     * Set these to filter the paginated testsets list
     */
    filters: {
        /** Search term for filtering by name */
        searchTerm: testsetsSearchTermAtom,
        /** Date created filter */
        dateCreated: testsetsDateCreatedFilterAtom,
        /** Date modified filter */
        dateModified: testsetsDateModifiedFilterAtom,
        /** Export format preference (CSV/JSON) */
        exportFormat: testsetsExportFormatAtom,
    },
}

// Re-export types
export type {Testset, TestsetsResponse} from "./revisionSchema"
export type {TestsetListParams, TestsetDetailParams} from "./store"
export type {
    TestsetApiRow,
    TestsetTableRow,
    TestsetDateRange,
    TestsetPaginatedMeta,
} from "./paginatedStore"
