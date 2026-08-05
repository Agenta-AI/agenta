/**
 * Entity List Counts API
 *
 * Provides a shared, frontend-only list count API for entities that supports:
 * - `loadedCount` (actual rows shown)
 * - `totalCount` (if known)
 * - `hasMore` (based on cursor presence)
 * - `displayLabel` (e.g., "12 of 40", "12+", "12 of 40+")
 *
 * This module supports both paginated/infinite lists and regular lists,
 * correctly including local additions/deletions in the count summary.
 *
 * ## Usage
 *
 * ### Paginated Lists (with PaginatedEntityStore)
 *
 * ```ts
 * import { createPaginatedListCountsAtom } from '@agenta/entities/shared'
 *
 * const countsAtom = createPaginatedListCountsAtom(
 *   testcasePaginatedStore,
 *   { scopeId, pageSize: 50 },
 *   { totalCountMode: 'unknown' }
 * )
 *
 * const counts = useAtomValue(countsAtom)
 * // counts.displayLabel -> "35+" or "35 of 100+"
 * ```
 *
 * ### Regular Lists (non-paginated)
 *
 * ```ts
 * import { createListCountsAtom } from '@agenta/entities/shared'
 *
 * const countsAtom = createListCountsAtom(myListAtom)
 * const counts = useAtomValue(countsAtom)
 * // counts.displayLabel -> "12"
 * ```
 *
 * @module listCounts
 */

import type {Atom} from "jotai"
import {atom} from "jotai"
import {atomFamily} from "jotai-family"

import type {
    BaseTableMeta,
    InfiniteTableRowBase,
    PaginatedControllerParams,
    PaginatedEntityStore,
    WindowingState,
} from "./tableTypes"

// ============================================================================
// TYPES
// ============================================================================

/**
 * How to interpret the `totalCount` from the server response.
 *
 * - `"total"`: `totalCount` is a real server total (display exact count).
 * - `"page"`: treat as page count (display `+` if `hasMore` is true).
 * - `"unknown"`: ignore `totalCount`, display `+` when cursor is present.
 */
export type TotalCountMode = "total" | "page" | "unknown"

/**
 * Configuration for list count computation.
 */
export interface ListCountsConfig {
    /**
     * How to interpret the server's totalCount.
     * @default "unknown"
     */
    totalCountMode?: TotalCountMode

    /**
     * Custom function to determine if a row should be counted.
     * By default, skeleton rows (`__isSkeleton === true`) are excluded.
     */
    isRowCountable?: (row: InfiniteTableRowBase) => boolean

    /**
     * Custom label formatter.
     * If not provided, uses the default `formatListCountLabel`.
     */
    formatLabel?: (counts: Omit<EntityListCounts, "displayLabel" | "displayLabelShort">) => string

    /**
     * Custom short label formatter.
     * If not provided, uses the default short format.
     */
    formatLabelShort?: (
        counts: Omit<EntityListCounts, "displayLabel" | "displayLabelShort">,
    ) => string
}

/**
 * Local delta tracking for client-side additions/deletions.
 */
export interface LocalDelta {
    /** Number of locally added rows */
    added: number
    /** Number of locally removed rows */
    removed: number
}

/**
 * Unified list count summary for entities.
 *
 * This is the primary output type for list count APIs.
 */
export interface EntityListCounts {
    /** Number of rows currently loaded and displayed (excludes skeletons) */
    loadedCount: number

    /** Total count from server (null if unknown or not provided) */
    totalCount: number | null

    /** Whether more data is available (based on cursor presence) */
    hasMore: boolean

    /** Whether the total count is known and reliable */
    isTotalKnown: boolean

    /** Display label (e.g., "12 of 40", "12+", "12 of 40+") */
    displayLabel: string

    /** Short display label (e.g., "12", "12+") */
    displayLabelShort: string

    /** Display suffix ("+" if hasMore, "" otherwise) */
    displaySuffix: "+" | ""

    /** Optional local delta tracking */
    localDelta?: LocalDelta
}

/**
 * Pagination state shape expected from paginated stores.
 */
export interface PaginationState {
    hasMore: boolean
    nextCursor: string | null
    nextOffset: number | null
    isFetching: boolean
    totalCount: number | null
    nextWindowing?: WindowingState | null
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Default row countable check - excludes skeleton rows.
 */
export const defaultIsRowCountable = (row: InfiniteTableRowBase): boolean => {
    return row.__isSkeleton !== true
}

/**
 * Check if there are more pages based on cursor/windowing presence.
 *
 * This is the canonical signal for "has more" - cursor presence is the source of truth.
 */
export const hasMorePages = (pagination: PaginationState): boolean => {
    // Check cursor first (most common)
    if (pagination.nextCursor !== null) {
        return true
    }

    // Check windowing (for window-based pagination)
    if (pagination.nextWindowing?.next !== null && pagination.nextWindowing?.next !== undefined) {
        return true
    }

    // Fall back to explicit hasMore flag
    return pagination.hasMore
}

/**
 * Format list count label based on counts and configuration.
 *
 * Display rules:
 * - If `hasMore` is true, display suffix `"+"` regardless of total.
 * - If `totalCount` is unknown, show `"loadedCount+"`.
 * - If `totalCount` is known and `hasMore` is true, show `"loadedCount of totalCount+"`.
 * - If `hasMore` is false, show `"loadedCount"` or `"loadedCount of totalCount"`.
 */
export const formatListCountLabel = (
    counts: Omit<EntityListCounts, "displayLabel" | "displayLabelShort">,
): string => {
    const {loadedCount, totalCount, hasMore, isTotalKnown} = counts
    const suffix = hasMore ? "+" : ""

    // If total is known and different from loaded, show "x of y"
    if (isTotalKnown && totalCount !== null && totalCount !== loadedCount) {
        return `${loadedCount} of ${totalCount}${suffix}`
    }

    // Otherwise just show loaded count
    return `${loadedCount}${suffix}`
}

/**
 * Format short list count label (just the count with optional suffix).
 */
export const formatListCountLabelShort = (
    counts: Omit<EntityListCounts, "displayLabel" | "displayLabelShort">,
): string => {
    const {loadedCount, hasMore} = counts
    const suffix = hasMore ? "+" : ""
    return `${loadedCount}${suffix}`
}

/**
 * Compute list counts from raw values.
 *
 * This is the core computation function used by both paginated and regular list atoms.
 */
export const computeListCounts = (params: {
    loadedCount: number
    totalCount: number | null
    hasMore: boolean
    totalCountMode: TotalCountMode
    localDelta?: LocalDelta
    formatLabel?: ListCountsConfig["formatLabel"]
    formatLabelShort?: ListCountsConfig["formatLabelShort"]
}): EntityListCounts => {
    const {
        loadedCount,
        totalCount,
        hasMore,
        totalCountMode,
        localDelta,
        formatLabel = formatListCountLabel,
        formatLabelShort = formatListCountLabelShort,
    } = params

    // Determine if total is known based on mode
    const isTotalKnown = totalCountMode === "total" && totalCount !== null

    // Build base counts (without labels)
    const baseCounts: Omit<EntityListCounts, "displayLabel" | "displayLabelShort"> = {
        loadedCount,
        totalCount: isTotalKnown ? totalCount : null,
        hasMore,
        isTotalKnown,
        displaySuffix: hasMore ? "+" : "",
        localDelta,
    }

    // Compute labels
    const displayLabel = formatLabel(baseCounts)
    const displayLabelShort = formatLabelShort(baseCounts)

    return {
        ...baseCounts,
        displayLabel,
        displayLabelShort,
    }
}

// ============================================================================
// PAGINATED LIST COUNTS
// ============================================================================

/**
 * Create a list counts atom for a paginated entity store.
 *
 * This atom derives counts from the paginated store's rows and pagination state,
 * correctly accounting for client rows and excluded rows.
 *
 * @param store - The paginated entity store
 * @param params - Controller params (scopeId, pageSize)
 * @param config - Optional configuration for count computation
 * @returns Atom that produces EntityListCounts
 *
 * @example
 * ```ts
 * const countsAtom = createPaginatedListCountsAtom(
 *   testcasePaginatedStore,
 *   { scopeId: 'testcases-rev123', pageSize: 50 },
 *   { totalCountMode: 'unknown' }
 * )
 *
 * const counts = useAtomValue(countsAtom)
 * console.log(counts.displayLabel) // "35+" or "35 of 100+"
 * ```
 */
export function createPaginatedListCountsAtom<
    TRow extends InfiniteTableRowBase,
    TApiRow,
    TMeta extends BaseTableMeta,
>(
    store: PaginatedEntityStore<TRow, TApiRow, TMeta>,
    params: PaginatedControllerParams,
    config: ListCountsConfig = {},
): Atom<EntityListCounts> {
    const {
        totalCountMode = "unknown",
        isRowCountable = defaultIsRowCountable,
        formatLabel,
        formatLabelShort,
    } = config

    return atom((get) => {
        // Get state from paginated store
        const stateAtom = store.selectors.state(params)
        const state = get(stateAtom)

        // Count only countable rows (excludes skeletons by default)
        const loadedCount = state.rows.filter(isRowCountable).length

        // Determine hasMore from pagination state
        // For paginated stores, we use the hasMore from state which is derived from cursor
        const hasMore = state.hasMore

        // Get total count from state
        const totalCount = state.totalCount

        return computeListCounts({
            loadedCount,
            totalCount,
            hasMore,
            totalCountMode,
            formatLabel,
            formatLabelShort,
        })
    })
}

/**
 * Create a list counts atom family for paginated stores.
 *
 * This is useful when you need to create counts atoms for multiple scopes
 * and want to cache them efficiently.
 *
 * @param store - The paginated entity store
 * @param config - Optional configuration for count computation
 * @returns Atom family that produces EntityListCounts atoms
 *
 * @example
 * ```ts
 * const countsFamily = createPaginatedListCountsAtomFamily(
 *   testcasePaginatedStore,
 *   { totalCountMode: 'unknown' }
 * )
 *
 * // In component:
 * const countsAtom = useMemo(
 *   () => countsFamily({ scopeId, pageSize: 50 }),
 *   [scopeId]
 * )
 * const counts = useAtomValue(countsAtom)
 * ```
 */
export function createPaginatedListCountsAtomFamily<
    TRow extends InfiniteTableRowBase,
    TApiRow,
    TMeta extends BaseTableMeta,
>(
    store: PaginatedEntityStore<TRow, TApiRow, TMeta>,
    config: ListCountsConfig = {},
): (params: PaginatedControllerParams) => Atom<EntityListCounts> {
    const paramsKey = (params: PaginatedControllerParams) => `${params.scopeId}:${params.pageSize}`

    return atomFamily(
        (params: PaginatedControllerParams) => createPaginatedListCountsAtom(store, params, config),
        (a, b) => paramsKey(a) === paramsKey(b),
    )
}

// ============================================================================
// REGULAR LIST COUNTS
// ============================================================================

/**
 * Create a list counts atom for a regular (non-paginated) list.
 *
 * For regular lists:
 * - `totalCount` equals `loadedCount`
 * - `hasMore` is always false
 * - `isTotalKnown` is always true
 *
 * @param listAtom - Atom providing the list data
 * @param config - Optional configuration
 * @returns Atom that produces EntityListCounts
 *
 * @example
 * ```ts
 * const countsAtom = createListCountsAtom(myListAtom)
 * const counts = useAtomValue(countsAtom)
 * console.log(counts.displayLabel) // "12"
 * ```
 */
export function createListCountsAtom<TRow extends InfiniteTableRowBase>(
    listAtom: Atom<TRow[]>,
    config: Pick<ListCountsConfig, "isRowCountable" | "formatLabel" | "formatLabelShort"> = {},
): Atom<EntityListCounts> {
    const {isRowCountable = defaultIsRowCountable, formatLabel, formatLabelShort} = config

    return atom((get) => {
        const rows = get(listAtom)
        const loadedCount = rows.filter(isRowCountable).length

        return computeListCounts({
            loadedCount,
            totalCount: loadedCount,
            hasMore: false,
            totalCountMode: "total",
            formatLabel,
            formatLabelShort,
        })
    })
}

/**
 * Create a list counts atom from raw pagination state.
 *
 * This is useful when you have direct access to pagination state
 * (e.g., from a custom store or hook) rather than a PaginatedEntityStore.
 *
 * @param rowsAtom - Atom providing the rows
 * @param paginationAtom - Atom providing the pagination state
 * @param config - Optional configuration
 * @returns Atom that produces EntityListCounts
 *
 * @example
 * ```ts
 * const countsAtom = createListCountsFromPaginationAtom(
 *   myRowsAtom,
 *   myPaginationAtom,
 *   { totalCountMode: 'unknown' }
 * )
 * ```
 */
export function createListCountsFromPaginationAtom<TRow extends InfiniteTableRowBase>(
    rowsAtom: Atom<TRow[]>,
    paginationAtom: Atom<PaginationState>,
    config: ListCountsConfig = {},
): Atom<EntityListCounts> {
    const {
        totalCountMode = "unknown",
        isRowCountable = defaultIsRowCountable,
        formatLabel,
        formatLabelShort,
    } = config

    return atom((get) => {
        const rows = get(rowsAtom)
        const pagination = get(paginationAtom)

        const loadedCount = rows.filter(isRowCountable).length
        const hasMore = hasMorePages(pagination)

        return computeListCounts({
            loadedCount,
            totalCount: pagination.totalCount,
            hasMore,
            totalCountMode,
            formatLabel,
            formatLabelShort,
        })
    })
}

// ============================================================================
// UTILITY ATOMS
// ============================================================================

/**
 * Create a simple display label atom from a list counts atom.
 *
 * This is a convenience wrapper when you only need the display label.
 *
 * @param countsAtom - Atom providing EntityListCounts
 * @returns Atom that produces the display label string
 */
export function createDisplayLabelAtom(countsAtom: Atom<EntityListCounts>): Atom<string> {
    return atom((get) => get(countsAtom).displayLabel)
}

/**
 * Create a short display label atom from a list counts atom.
 *
 * @param countsAtom - Atom providing EntityListCounts
 * @returns Atom that produces the short display label string
 */
export function createDisplayLabelShortAtom(countsAtom: Atom<EntityListCounts>): Atom<string> {
    return atom((get) => get(countsAtom).displayLabelShort)
}

/**
 * Create a hasMore atom from a list counts atom.
 *
 * @param countsAtom - Atom providing EntityListCounts
 * @returns Atom that produces the hasMore boolean
 */
export function createHasMoreAtom(countsAtom: Atom<EntityListCounts>): Atom<boolean> {
    return atom((get) => get(countsAtom).hasMore)
}
