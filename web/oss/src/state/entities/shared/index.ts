/**
 * Shared entity utilities and patterns
 *
 * This module provides reusable patterns and utilities for working with entities
 * across different entity types (testsets, testcases, traces, etc.)
 */

// Query result type (used by controllers)
export {type QueryResult} from "./createStatefulEntityAtomFamily"

// Entity draft state pattern
export {createEntityDraftState} from "./createEntityDraftState"

// Entity controller pattern - unified API for entity access
export {
    createEntityController,
    type DrillInConfig,
    type DrillInValueMode,
    type EntityAction,
    type EntityAPI,
    type EntityActions,
    type EntityControllerAtomFamily,
    type EntityControllerConfig,
    type EntityControllerState,
    type EntityDrillIn,
    type EntitySelectors,
    type PathItem,
    type QueryState,
    type UseEntityControllerResult,
} from "./createEntityController"

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
