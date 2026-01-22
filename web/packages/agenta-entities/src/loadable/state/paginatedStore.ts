/**
 * Loadable Paginated Store
 *
 * Provides paginated data access for loadable entities with InfiniteVirtualTable integration.
 * Unlike testcasePaginatedStore which fetches from API, this store reads from local loadable state.
 *
 * ## Usage
 *
 * ```typescript
 * import { loadablePaginatedStore, loadablePaginatedMetaAtom } from '@agenta/entities/loadable'
 *
 * // Set the loadable ID to display
 * const setLoadableId = useSetAtom(loadablePaginatedMetaAtom)
 * setLoadableId({ loadableId: 'my-loadable-id' })
 *
 * // Use with InfiniteVirtualTableFeatureShell
 * <InfiniteVirtualTableFeatureShell
 *   datasetStore={loadablePaginatedStore}
 *   tableScope={{ scopeId: `loadable-${loadableId}`, pageSize: 50 }}
 *   columns={columns}
 *   rowKey="key"
 * />
 * ```
 */

import {projectIdAtom} from "@agenta/shared"
import {
    createPaginatedEntityStore,
    type InfiniteTableFetchResult,
    type PaginatedEntityStore,
} from "@agenta/ui"
import {atom} from "jotai"
import type {Atom} from "jotai"

import {loadableController} from "../controller"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Row type for loadable table (matches loadable row structure)
 */
export interface LoadableTableRow {
    id: string
    key: string
    data: Record<string, unknown>
    __isSkeleton?: boolean
    __isNew?: boolean
    [key: string]: unknown
}

/**
 * Meta for loadable paginated queries
 */
export interface LoadablePaginatedMeta {
    projectId: string | null
    loadableId: string | null
}

// ============================================================================
// FILTER ATOMS
// ============================================================================

/**
 * Current loadable ID for paginated queries
 */
export const loadableIdAtom = atom<string | null>(null)

// ============================================================================
// META ATOM
// ============================================================================

/**
 * Combined meta atom for paginated store
 */
export const loadablePaginatedMetaAtom: Atom<LoadablePaginatedMeta> = atom((get) => ({
    projectId: get(projectIdAtom),
    loadableId: get(loadableIdAtom),
}))

// ============================================================================
// PAGINATED STORE
// ============================================================================

/**
 * Skeleton row defaults for loading state
 */
const skeletonDefaults: Partial<LoadableTableRow> = {
    id: "",
    key: "",
    data: {},
    __isSkeleton: true,
}

/**
 * Fetch loadable rows - reads from local loadable state (no API call)
 *
 * This is a "fake" fetch that reads from the loadable entity's local state.
 * It returns all rows immediately since loadable data is already in memory.
 */
async function fetchLoadableRows({
    meta,
}: {
    meta: LoadablePaginatedMeta
    limit: number
    cursor?: string | null
}): Promise<InfiniteTableFetchResult<LoadableTableRow>> {
    const {loadableId} = meta

    // Skip fetch for empty loadable ID
    if (!loadableId) {
        return {
            rows: [],
            totalCount: 0,
            hasMore: false,
            nextCursor: null,
            nextOffset: null,
            nextWindowing: null,
        }
    }

    // This is a synchronous read from Jotai state, but we need to return a Promise
    // The actual data will be provided via clientRowsAtom below
    return {
        rows: [],
        totalCount: 0,
        hasMore: false,
        nextCursor: null,
        nextOffset: null,
        nextWindowing: null,
    }
}

/**
 * Client rows atom - provides loadable rows from local state.
 * This is the primary data source for the paginated store.
 */
const clientRowsAtom: Atom<LoadableTableRow[]> = atom((get) => {
    const meta = get(loadablePaginatedMetaAtom)
    const {loadableId} = meta

    if (!loadableId) {
        return []
    }

    // Get rows from loadable controller
    const rowsAtom = loadableController.testset.selectors.rows(loadableId)
    const rows = get(rowsAtom) as {id: string; data: Record<string, unknown>}[]

    if (!rows || rows.length === 0) {
        return []
    }

    // Transform to table row format
    return rows.map((row) => ({
        id: row.id,
        key: row.id,
        data: row.data,
        __isSkeleton: false,
        __isNew: false,
        // Spread data fields to top level for column access
        ...row.data,
    }))
})

/**
 * Loadable paginated store for InfiniteVirtualTable
 *
 * This store reads from local loadable state instead of fetching from API.
 * All data is provided via clientRowsAtom, making fetchPage a no-op.
 */
export const loadablePaginatedStore: PaginatedEntityStore<
    LoadableTableRow,
    LoadableTableRow,
    LoadablePaginatedMeta
> = createPaginatedEntityStore<LoadableTableRow, LoadableTableRow, LoadablePaginatedMeta>({
    entityName: "loadable",
    metaAtom: loadablePaginatedMetaAtom,
    fetchPage: fetchLoadableRows,
    rowConfig: {
        getRowId: (row) => row.id,
        skeletonDefaults,
    },
    transformRow: (row): LoadableTableRow => row,
    isEnabled: (meta) => Boolean(meta?.loadableId),
    // Client rows: all loadable data comes from local state
    clientRowsAtom,
})

// ============================================================================
// FILTERS NAMESPACE
// ============================================================================

/**
 * Filter atoms namespace for loadable
 */
export const loadableFilters = {
    loadableId: loadableIdAtom,
}
