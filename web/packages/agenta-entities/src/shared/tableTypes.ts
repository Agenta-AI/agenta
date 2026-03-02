/**
 * Table Types for Entity Integration
 *
 * These types are defined locally to avoid a dependency on @agenta/ui.
 * They mirror the types from @agenta/ui/table that are needed for entity
 * paginated stores and data controllers.
 *
 * IMPORTANT: These types must stay in sync with @agenta/ui/table types.
 * When updating, check:
 * - @agenta/ui/src/InfiniteVirtualTable/types.ts
 * - @agenta/ui/src/InfiniteVirtualTable/paginated/createPaginatedEntityStore.ts
 *
 * @module tableTypes
 */

import type {Key} from "react"

import type {Atom, WritableAtom, PrimitiveAtom} from "jotai"

// ============================================================================
// BASE ROW TYPE
// ============================================================================

/**
 * Base interface for table rows used in InfiniteVirtualTable.
 * Mirrors InfiniteTableRowBase from @agenta/ui/table.
 */
export interface InfiniteTableRowBase {
    key: Key
    __isSkeleton?: boolean
    [key: string]: unknown
}

// ============================================================================
// WINDOWING STATE
// ============================================================================

/**
 * Windowing state for paginated queries.
 * Mirrors WindowingState from @agenta/ui/table.
 */
export interface WindowingState {
    next: string | null
    oldest?: string | null
    newest?: string | null
    stop?: string | null
    order?: string | null
    limit?: number | null
}

// ============================================================================
// FETCH RESULT
// ============================================================================

/**
 * Result shape for paginated fetch operations.
 * Mirrors InfiniteTableFetchResult from @agenta/ui/table.
 */
export interface InfiniteTableFetchResult<ApiRow> {
    rows: ApiRow[]
    totalCount: number | null
    hasMore: boolean
    nextOffset: number | null
    nextCursor: string | null
    nextWindowing: WindowingState | null
}

// ============================================================================
// LIST COUNTS
// ============================================================================

/**
 * How to interpret the `totalCount` from the server response.
 * Mirrors TotalCountMode from @agenta/ui/table.
 */
export type TotalCountMode = "total" | "page" | "unknown"

/**
 * Configuration for list count computation in paginated stores.
 * Mirrors ListCountsConfig from @agenta/ui/table.
 */
export interface ListCountsConfig {
    totalCountMode?: TotalCountMode
    isRowCountable?: (row: InfiniteTableRowBase) => boolean
}

/**
 * Unified list count summary for entities.
 * Mirrors EntityListCounts from @agenta/ui/table.
 */
export interface EntityListCounts {
    loadedCount: number
    totalCount: number | null
    hasMore: boolean
    isTotalKnown: boolean
    displayLabel: string
    displayLabelShort: string
    displaySuffix: "+" | ""
}

// ============================================================================
// PAGINATED STORE TYPES
// ============================================================================

/**
 * Base meta type for table queries.
 * Mirrors BaseTableMeta from @agenta/ui/table.
 */
export type BaseTableMeta = Record<string, unknown>

/**
 * Controller parameters for paginated stores.
 * Mirrors PaginatedControllerParams from @agenta/ui/table.
 */
export interface PaginatedControllerParams {
    scopeId: string
    pageSize: number
}

/**
 * Combined paginated state.
 * Mirrors PaginatedCombinedState from @agenta/ui/table.
 */
export interface PaginatedCombinedState<TRow> {
    rows: TRow[]
    isFetching: boolean
    hasMore: boolean
    totalCount: number | null
    nextCursor: string | null
    nextOffset: number | null
    selectedKeys: Key[]
}

/**
 * Paginated controller action.
 * Mirrors PaginatedControllerAction from @agenta/ui/table.
 */
export type PaginatedControllerAction =
    | {type: "loadMore"}
    | {type: "refresh"}
    | {type: "select"; keys: Key[]}

/**
 * Paginated controller state (rows + pagination + selection).
 * Mirrors PaginatedControllerState from @agenta/ui/table.
 */
export interface PaginatedControllerState<TRow> {
    rows: TRow[]
    hasMore: boolean
    isFetching: boolean
    totalCount: number | null
    selectedKeys: Key[]
}

/**
 * Paginated entity store interface.
 * Mirrors PaginatedEntityStore from @agenta/ui/table.
 *
 * This is a simplified version that only includes the selectors needed
 * by @agenta/entities for list counts and data controllers.
 */
export interface PaginatedEntityStore<
    TRow extends InfiniteTableRowBase,
    _TApiRow = TRow,
    _TMeta = unknown,
> {
    entityName: string

    selectors: {
        state: (params: PaginatedControllerParams) => Atom<PaginatedCombinedState<TRow>>
        selection: (params: PaginatedControllerParams) => PrimitiveAtom<Key[]>
        listCounts: (params: PaginatedControllerParams) => Atom<EntityListCounts>
    }

    actions: {
        refresh: WritableAtom<number, [], void>
    }

    controller: (
        params: PaginatedControllerParams,
    ) => WritableAtom<PaginatedControllerState<TRow>, [PaginatedControllerAction], void>
}

// ============================================================================
// FETCH PARAMS
// ============================================================================

/**
 * Parameters for fetching table data.
 * Used by the internal table store.
 */
export interface InfiniteTableFetchParams<TMeta = unknown> {
    scopeId: string | null
    cursor: string | null
    limit: number
    offset: number
    windowing: WindowingState | null
    meta: TMeta | undefined
    get: (atom: Atom<unknown>) => unknown
}

/**
 * Page state for infinite tables.
 */
export interface InfiniteTablePage {
    offset: number
    limit: number
    cursor: string | null
    windowing: WindowingState | null
}

// ============================================================================
// COLUMN TYPES
// ============================================================================

/**
 * Minimal column interface required for grouping.
 * Mirrors GroupableColumn from @agenta/ui/utils.
 */
export interface GroupableColumn {
    key: string
    label?: string
    name?: string
    parentKey?: string
}
