import {atom} from "jotai"
import type {Atom} from "jotai"

import {createInfiniteDatasetStore} from "../createInfiniteDatasetStore"
import type {InfiniteDatasetStore} from "../createInfiniteDatasetStore"
import type {InfiniteTableFetchResult, InfiniteTableRowBase} from "../types"

import {createTableRowHelpers} from "./createTableRowHelpers"
import type {TableRowHelpersConfig} from "./createTableRowHelpers"

/**
 * Common date range filter type used across tables
 */
export interface DateRangeFilter {
    from?: string | null
    to?: string | null
}

/**
 * Base interface for table metadata.
 * All table stores should extend this with their specific filters.
 */
export interface BaseTableMeta {
    /** Project ID - required for all tables */
    projectId: string | null
    /** Search term for filtering */
    searchTerm?: string | null
    /** Date range filter */
    dateRange?: DateRangeFilter | null
    /** Internal refresh trigger - incrementing this forces a refetch */
    _refreshTrigger?: number
}

/**
 * Configuration for creating a simple table store
 */
export interface SimpleTableStoreConfig<
    TRow extends InfiniteTableRowBase,
    TApiRow,
    TMeta extends BaseTableMeta,
> {
    /** Unique key for the store (used for caching) */
    key: string
    /** Atom that provides the table metadata */
    metaAtom: Atom<TMeta>
    /** Configuration for row helpers (skeleton/merge) */
    rowHelpers: TableRowHelpersConfig<TRow, TApiRow>
    /**
     * Fetch function that retrieves data from the API.
     * Should handle pagination via limit/offset/cursor.
     */
    fetchData: (params: {
        meta: TMeta
        limit: number
        offset: number
        cursor: string | null
    }) => Promise<InfiniteTableFetchResult<TApiRow>>
    /**
     * Optional custom isEnabled check.
     * Defaults to checking if projectId exists.
     */
    isEnabled?: (meta: TMeta | undefined) => boolean
}

/**
 * Result of createSimpleTableStore
 */
export interface SimpleTableStore<
    TRow extends InfiniteTableRowBase,
    TApiRow,
    TMeta extends BaseTableMeta,
> {
    /** The underlying infinite dataset store */
    datasetStore: InfiniteDatasetStore<TRow, TApiRow, TMeta>
    /** Row helpers for creating skeletons and merging data */
    rowHelpers: ReturnType<typeof createTableRowHelpers<TRow, TApiRow>>
    /** Refresh trigger atom - increment to force refetch */
    refreshTriggerAtom: ReturnType<typeof atom<number>>
}

/**
 * Creates a simplified table store with common patterns pre-configured.
 * Reduces boilerplate for standard paginated tables.
 *
 * @example
 * ```ts
 * const {datasetStore, refreshTriggerAtom} = createSimpleTableStore({
 *   key: "testsets-table",
 *   metaAtom: testsetsTableMetaAtom,
 *   rowHelpers: {
 *     entityName: "testset",
 *     skeletonDefaults: {id: "", name: "", created_at: "", updated_at: ""},
 *     getRowId: (row) => row.id,
 *   },
 *   fetchData: async ({meta, limit, offset, cursor}) => {
 *     return fetchTestsetsWindow({projectId: meta.projectId, limit, offset, cursor})
 *   },
 * })
 * ```
 */
export function createSimpleTableStore<
    TRow extends InfiniteTableRowBase,
    TApiRow,
    TMeta extends BaseTableMeta,
>(config: SimpleTableStoreConfig<TRow, TApiRow, TMeta>): SimpleTableStore<TRow, TApiRow, TMeta> {
    const {key, metaAtom, rowHelpers: rowHelpersConfig, fetchData, isEnabled} = config

    // Create row helpers
    const rowHelpers = createTableRowHelpers<TRow, TApiRow>(rowHelpersConfig)

    // Create refresh trigger atom
    const refreshTriggerAtom = atom(0)

    // Create the dataset store
    const datasetStore = createInfiniteDatasetStore<TRow, TApiRow, TMeta>({
        key,
        metaAtom,
        createSkeletonRow: rowHelpers.createSkeletonRow,
        mergeRow: rowHelpers.mergeRow,
        isEnabled: isEnabled ?? ((meta) => Boolean(meta?.projectId)),
        fetchPage: async ({limit, offset, cursor, meta}) => {
            if (!meta?.projectId) {
                return {
                    rows: [],
                    totalCount: 0,
                    hasMore: false,
                    nextOffset: null,
                    nextCursor: null,
                    nextWindowing: null,
                }
            }

            return fetchData({meta, limit, offset, cursor})
        },
    })

    return {
        datasetStore,
        rowHelpers,
        refreshTriggerAtom,
    }
}

/**
 * Helper to create a meta atom that combines projectId with filters.
 * Provides a consistent pattern for table metadata atoms.
 */
export function createTableMetaAtom<TFilters extends Record<string, unknown>>(config: {
    projectIdAtom: Atom<string | null>
    refreshTriggerAtom: Atom<number>
    filterAtoms: {[K in keyof TFilters]: Atom<TFilters[K]>}
}): Atom<BaseTableMeta & TFilters> {
    const {projectIdAtom, refreshTriggerAtom, filterAtoms} = config

    return atom((get) => {
        const projectId = get(projectIdAtom)
        const _refreshTrigger = get(refreshTriggerAtom)

        const filters = {} as TFilters
        for (const key of Object.keys(filterAtoms) as (keyof TFilters)[]) {
            filters[key] = get(filterAtoms[key])
        }

        return {
            projectId,
            _refreshTrigger,
            ...filters,
        }
    })
}
