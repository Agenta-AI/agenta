/**
 * Paginated Entity Store
 *
 * Factory for creating paginated entity stores that work with InfiniteVirtualTable.
 */

export {
    createPaginatedEntityStore,
    // Types
    type PaginatedEntityRow,
    type PaginatedEntityMeta,
    type PaginatedEntityStore,
    type PaginatedEntityStoreConfig,
    type PaginatedEntityRowConfig,
    type PaginatedFetchParams,
    type PaginatedControllerParams,
    type PaginatedControllerState,
    type PaginatedControllerAction,
    type PaginatedState,
    type PaginatedCombinedState,
    // List counts types
    type TotalCountMode,
    type ListCountsConfig,
    type EntityListCounts,
} from "./createPaginatedEntityStore"

// Re-export table types needed for paginated stores
export type {BaseTableMeta, SimpleTableStore} from "../helpers/createSimpleTableStore"

export type {InfiniteTableFetchResult, InfiniteTableRowBase, WindowingState} from "../types"
