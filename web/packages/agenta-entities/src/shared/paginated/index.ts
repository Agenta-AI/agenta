/**
 * Paginated Store Module
 *
 * Self-contained paginated table store infrastructure.
 * Provides infinite scrolling, skeleton states, and entity-aware pagination.
 *
 * This module is copied from @agenta/ui to avoid circular dependencies
 * and allow @agenta/entities to be used standalone.
 */

// Core stores
export {
    createInfiniteTableStore,
    type InfiniteTableStore,
    type TableRowAtomKey,
    type TablePagesKey,
} from "./createInfiniteTableStore"

export {
    createInfiniteDatasetStore,
    type InfiniteDatasetStore,
    type InfiniteDatasetStoreConfig,
} from "./createInfiniteDatasetStore"

export {
    createSimpleTableStore,
    createTableMetaAtom,
    type BaseTableMeta,
    type DateRangeFilter,
    type SimpleTableStore,
    type SimpleTableStoreConfig,
} from "./createSimpleTableStore"

// Paginated entity store (main factory)
export {
    createPaginatedEntityStore,
    type EntityListCounts,
    type ListCountsConfig,
    type PaginatedCombinedState,
    type PaginatedControllerAction,
    type PaginatedControllerParams,
    type PaginatedControllerState,
    type PaginatedEntityRow,
    type PaginatedEntityRowConfig,
    type PaginatedEntityStore,
    type PaginatedEntityStoreConfig,
    type PaginatedEntityMeta,
    type PaginatedFetchParams,
    type PaginatedState,
    type TotalCountMode,
} from "./createPaginatedEntityStore"

// Row helpers
export {
    createTableRowHelpers,
    type CreateSkeletonRowParams,
    type MergeRowParams,
    type TableRowHelpers,
    type TableRowHelpersConfig,
} from "./createTableRowHelpers"

// React hook
export {default as useInfiniteTablePagination} from "./useInfiniteTablePagination"
