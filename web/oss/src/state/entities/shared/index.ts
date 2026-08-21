/**
 * Shared entity utilities and patterns
 *
 * This module provides reusable patterns and utilities for working with entities
 * across different entity types (testsets, testcases, traces, etc.)
 */

// Query result type (used by controllers)
export {type QueryResult} from "./createStatefulEntityAtomFamily"

// Paginated entity store pattern - for infinite scroll tables
export {
    createPaginatedEntityStore,
    // Type helpers
    type PaginatedEntityRow,
    type PaginatedEntityMeta,
    // Store types
    type PaginatedEntityStore,
    type PaginatedEntityStoreConfig,
    type PaginatedEntityRowConfig,
    type PaginatedFetchParams,
    // Controller types
    type PaginatedControllerParams,
    type PaginatedControllerState,
    type PaginatedControllerAction,
    type PaginatedState,
} from "./createPaginatedEntityStore"

export {createDateDescComparator, emptyFetchResult, getCursorOffset} from "./utils"
