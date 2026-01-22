/**
 * Loadable State Module
 *
 * Exports state management utilities for loadable entities.
 */

// Paginated store for InfiniteVirtualTable
export {
    loadablePaginatedStore,
    loadablePaginatedMetaAtom,
    loadableIdAtom,
    loadableFilters,
    type LoadableTableRow,
    type LoadablePaginatedMeta,
} from "./paginatedStore"
