/**
 * @deprecated This file is deprecated. Use the centralized entity store instead:
 *
 * ```typescript
 * import { testset, type TestsetTableRow } from "@/oss/state/entities/testset"
 *
 * // Option 1: Use with useTableManager (recommended for InfiniteVirtualTable)
 * const table = useTableManager({
 *   datasetStore: testset.paginated.store,
 *   scopeId: 'testsets-page',
 *   pageSize: 50,
 * })
 *
 * // Option 2: Use controller for fine-grained atom access
 * const [state, dispatch] = useAtom(testset.paginated.controller({
 *   scopeId: 'testsets-page',
 *   pageSize: 50,
 * }))
 * // state.rows, state.isFetching, state.hasMore, state.selectedKeys
 * // dispatch({ type: 'refresh' }), dispatch({ type: 'select', keys: [...] })
 *
 * // Option 3: Use individual selectors for minimal re-renders
 * const rows = useAtomValue(testset.paginated.selectors.rows({scopeId, pageSize}))
 * const pagination = useAtomValue(testset.paginated.selectors.pagination({scopeId, pageSize}))
 *
 * // Trigger refresh
 * const refresh = useSetAtom(testset.paginated.actions.refresh)
 * refresh()
 *
 * // Access filters
 * testset.filters.searchTerm
 * testset.filters.exportFormat
 * testset.filters.dateCreated
 * testset.filters.dateModified
 * ```
 *
 * This file is kept for backwards compatibility only and should not be used in new code.
 */

import {testset} from "@/oss/state/entities/testset"

// Re-export types from entity store
export type {
    TestsetApiRow,
    TestsetTableRow,
    TestsetDateRange,
    TestsetPaginatedMeta as TestsetTableMeta,
} from "@/oss/state/entities/testset"

/**
 * @deprecated Use `testset.filters.exportFormat` instead
 */
export const testsetsExportFormatAtom = testset.filters.exportFormat

/**
 * @deprecated Use `testset.filters.searchTerm` instead
 */
export const testsetsSearchTermAtom = testset.filters.searchTerm

/**
 * @deprecated Use `testset.paginated.refreshAtom` instead
 */
export const testsetsRefreshTriggerAtom = testset.paginated.refreshAtom

/**
 * @deprecated Use `testset.paginated.metaAtom` instead
 */
export const testsetsTableMetaAtom = testset.paginated.metaAtom

/**
 * @deprecated Use `testset.paginated.store` instead
 */
export const testsetsDatasetStore = testset.paginated.store
