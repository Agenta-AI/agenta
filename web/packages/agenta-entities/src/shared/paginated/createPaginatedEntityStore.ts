/**
 * Paginated Entity Store Factory
 *
 * Factory for creating paginated entity stores with controller-compatible API.
 * Copied from @agenta/ui to avoid dependency.
 */

import type {Key} from "react"

import type {Atom, PrimitiveAtom, WritableAtom} from "jotai"
import {atom} from "jotai"
import {getDefaultStore} from "jotai"

// Use the instrumented wrapper so each store can be `dispose()`-d.
// See createInfiniteTableStore.ts for rationale.
import {instrumentedAtomFamily} from "../molecule/instrumentedAtomFamily"
import type {InfiniteTableFetchResult, InfiniteTableRowBase, WindowingState} from "../tableTypes"

import {createSimpleTableStore} from "./createSimpleTableStore"
import type {BaseTableMeta, SimpleTableStore} from "./createSimpleTableStore"

// ============================================================================
// LIST COUNTS TYPES
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
 * Configuration for list count computation in paginated stores.
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
}

/**
 * Unified list count summary for entities.
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
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * Fetch parameters passed to the paginated fetch function
 */
export interface PaginatedFetchParams<TMeta extends BaseTableMeta> {
    meta: TMeta
    limit: number
    offset: number
    cursor: string | null
    windowing: WindowingState | null
}

/**
 * Row configuration for paginated entity store
 */
export interface PaginatedEntityRowConfig<TRow, TApiRow = TRow> {
    /** Function to extract unique ID from an API row (used as row key) */
    getRowId: (apiRow: TApiRow) => string
    /** Default values for skeleton rows (shown during loading) */
    skeletonDefaults: Partial<TRow>
}

/**
 * Configuration for creating a paginated entity store
 */
export interface PaginatedEntityStoreConfig<
    TRow extends InfiniteTableRowBase,
    TApiRow,
    TMeta extends BaseTableMeta,
> {
    /** Entity name (used for store key and debugging) */
    entityName: string

    /** Atom providing the query metadata (projectId, filters, etc.) */
    metaAtom: Atom<TMeta>

    /**
     * Fetch function for paginated data.
     * Should return InfiniteTableFetchResult with pagination info.
     */
    fetchPage: (params: PaginatedFetchParams<TMeta>) => Promise<InfiniteTableFetchResult<TApiRow>>

    /** Row configuration (ID extraction, skeleton defaults) */
    rowConfig: PaginatedEntityRowConfig<TRow, TApiRow>

    /**
     * Optional: Atom providing client-side rows (unsaved drafts).
     * These are prepended to server rows.
     */
    clientRowsAtom?: Atom<TRow[]>

    /**
     * Optional: Atom providing IDs to exclude from display.
     * Useful for soft-deleted rows before save.
     */
    excludeRowIdsAtom?: Atom<Set<string>>

    /**
     * Optional: Custom enabled check.
     * Defaults to checking if projectId exists.
     */
    isEnabled?: (meta: TMeta | undefined) => boolean

    /**
     * Optional: Transform API rows to table rows.
     * If not provided, assumes TRow === TApiRow.
     */
    transformRow?: (apiRow: TApiRow) => TRow

    /**
     * Optional: Configuration for list count computation.
     * Controls how counts are displayed (e.g., "12+", "12 of 40").
     */
    listCountsConfig?: ListCountsConfig
}

// ============================================================================
// CONTROLLER TYPES
// ============================================================================

/**
 * Parameters for controller/selector atom families
 */
export interface PaginatedControllerParams {
    /** Unique scope identifier (e.g., 'testcases-{revisionId}') */
    scopeId: string
    /** Number of rows per page */
    pageSize: number
}

/**
 * Pagination state returned by selectors
 */
export interface PaginatedState {
    /** Whether more pages exist */
    hasMore: boolean
    /** Cursor for next page */
    nextCursor: string | null
    /** Offset for next page */
    nextOffset: number | null
    /** Whether currently fetching */
    isFetching: boolean
    /** Total count of rows (if known) */
    totalCount: number | null
}

/**
 * Combined state (rows + pagination) - read-only
 * Use this when you need both rows and pagination status but don't need selection
 */
export interface PaginatedCombinedState<TRow> {
    /** Array of rows (includes skeletons during loading) */
    rows: TRow[]
    /** Whether more pages exist */
    hasMore: boolean
    /** Whether currently fetching */
    isFetching: boolean
    /** Total count of rows (if known) */
    totalCount: number | null
}

/**
 * Full controller state (rows + pagination + selection)
 */
export interface PaginatedControllerState<TRow> {
    /** Array of rows (includes skeletons during loading) */
    rows: TRow[]
    /** Whether more pages exist */
    hasMore: boolean
    /** Whether currently fetching */
    isFetching: boolean
    /** Total count of rows (if known) */
    totalCount: number | null
    /** Selected row keys */
    selectedKeys: Key[]
}

/**
 * Actions that can be dispatched to the controller
 */
export type PaginatedControllerAction =
    | {type: "refresh"}
    | {type: "select"; keys: Key[]}
    | {type: "selectAll"}
    | {type: "clearSelection"}
    | {type: "toggleSelection"; key: Key}

// ============================================================================
// PAGINATED ENTITY STORE INTERFACE
// ============================================================================

/**
 * Result of createPaginatedEntityStore.
 * Provides a controller-compatible API for paginated queries.
 */
export interface PaginatedEntityStore<
    TRow extends InfiniteTableRowBase,
    TApiRow,
    TMeta extends BaseTableMeta,
> {
    /** Entity name for debugging */
    entityName: string

    /** The underlying table store (for InfiniteVirtualTable integration) */
    store: SimpleTableStore<TRow, TApiRow, TMeta>["datasetStore"]

    /** Row helpers for creating skeletons and merging data */
    rowHelpers: SimpleTableStore<TRow, TApiRow, TMeta>["rowHelpers"]

    /**
     * Refresh trigger atom.
     * Increment to force a refetch of paginated data.
     *
     * @deprecated Use `actions.refresh` instead for consistency
     */
    refreshAtom: WritableAtom<number, [], void>

    /**
     * Meta atom providing the query parameters.
     * Read to access current filters, search term, etc.
     */
    metaAtom: Atom<TMeta>

    /**
     * Invalidate the paginated cache.
     * Call after mutations to ensure fresh data on next fetch.
     */
    invalidate: () => void

    // ========================================================================
    // CONTROLLER PATTERN
    // ========================================================================

    /**
     * Controller atom family - unified state + dispatch
     *
     * Returns [state, dispatch] tuple where:
     * - state: { rows, hasMore, isFetching, totalCount, selectedKeys }
     * - dispatch: function to handle actions
     */
    controller: (
        params: PaginatedControllerParams,
    ) => WritableAtom<PaginatedControllerState<TRow>, [PaginatedControllerAction], void>

    /**
     * Selectors for fine-grained subscriptions
     */
    selectors: {
        /**
         * Combined state atom (rows + pagination) - read-only
         */
        state: (params: PaginatedControllerParams) => Atom<PaginatedCombinedState<TRow>>

        /**
         * Selection atom (read/write)
         */
        selection: (params: PaginatedControllerParams) => PrimitiveAtom<Key[]>

        /**
         * List counts atom - unified count summary
         */
        listCounts: (params: PaginatedControllerParams) => Atom<EntityListCounts>
    }

    /**
     * Actions for imperative operations
     */
    actions: {
        /**
         * Refresh the paginated data
         */
        refresh: WritableAtom<number, [], void>
    }

    /**
     * Release every atomFamily entry this store + its underlying table store
     * own. Returns the total count of params removed. Call after a long-run
     * ETL pass to release accumulated closures from rotated scopeIds.
     */
    dispose: () => number

    /**
     * Diagnostic: per-family active param counts for this store instance.
     * Includes both this store's families and the inner table store's.
     */
    familySizes: () => {name: string; size: number}[]
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Creates a paginated entity store with controller-compatible API.
 *
 * This factory wraps `createSimpleTableStore` to provide:
 * - Consistent pagination patterns across entities
 * - Integration with InfiniteVirtualTable
 * - Client-side row support (drafts)
 * - Row exclusion (soft-deletes)
 * - Refresh/invalidation controls
 * - Controller pattern for unified state access
 */
export function createPaginatedEntityStore<
    TRow extends InfiniteTableRowBase,
    TApiRow = TRow,
    TMeta extends BaseTableMeta = BaseTableMeta,
>(
    config: PaginatedEntityStoreConfig<TRow, TApiRow, TMeta>,
): PaginatedEntityStore<TRow, TApiRow, TMeta> {
    const {
        entityName,
        metaAtom,
        fetchPage,
        rowConfig,
        clientRowsAtom,
        excludeRowIdsAtom,
        isEnabled,
        transformRow,
        listCountsConfig,
    } = config

    // List counts configuration with defaults
    const totalCountMode = listCountsConfig?.totalCountMode ?? "unknown"
    const isRowCountable = listCountsConfig?.isRowCountable ?? ((row) => row.__isSkeleton !== true)

    // Create internal refresh trigger
    const internalRefreshAtom = atom(0)

    // Wrap metaAtom to include refresh trigger
    const metaWithRefreshAtom = atom((get) => {
        const meta = get(metaAtom)
        const _refreshTrigger = get(internalRefreshAtom)
        return {...meta, _refreshTrigger}
    })

    // Create the underlying table store
    const {datasetStore, rowHelpers} = createSimpleTableStore<TRow, TApiRow, TMeta>({
        key: `${entityName}-paginated`,
        metaAtom: metaWithRefreshAtom as Atom<TMeta>,
        rowHelpers: {
            entityName,
            skeletonDefaults: rowConfig.skeletonDefaults as Omit<TRow, "key" | "__isSkeleton">,
            getRowId: rowConfig.getRowId,
            ...(transformRow && {apiToRow: transformRow}),
        },
        fetchData: fetchPage,
        isEnabled,
        clientRowsAtom,
        excludeRowIdsAtom,
    })

    // Create writable refresh atom
    const refreshAtom = atom(
        (get) => get(internalRefreshAtom),
        (_get, set) => {
            set(internalRefreshAtom, (prev) => prev + 1)
        },
    )

    // Invalidation function
    const invalidate = () => {
        const store = getDefaultStore()
        store.set(refreshAtom)
    }

    // ========================================================================
    // CONTROLLER PATTERN IMPLEMENTATION
    // ========================================================================

    // Helper to create params key for atomFamily
    const paramsKey = (params: PaginatedControllerParams) => `${params.scopeId}:${params.pageSize}`

    // Per-store family registry — dispose() iterates this to release every
    // entry. See createInfiniteTableStore.ts for the same pattern.
    interface ManagedFamily {
        clear: () => void
        size: () => number
        readonly name: string
    }
    const ownedFamilies: ManagedFamily[] = []
    // Accept both call shapes to be drop-in compatible with jotai-family:
    //   atomFamily(create, name)                — added by our migration
    //   atomFamily(create, areEqual, name)      — preserves original equality fn
    // The original jotai-family signature is (create, areEqual?). If we
    // dropped the areEqual through migration, params objects compared by
    // reference identity instead of structural equality, so every call
    // would create a fresh atom and break memoization (visible as
    // pagination state being lost between chunks).
    // Constrain `A extends Atom<unknown>` to match `instrumentedAtomFamily`'s
    // signature so the atom-type generic survives the wrapper. Returning the
    // erased `…<P, never>` shape (as the earlier version did) collapsed every
    // `get(family(params))` call to `unknown` — that's the leak the `as never`
    // casts were papering over.
    const atomFamily = <P, A extends Atom<unknown>>(
        create: (p: P) => A,
        areEqualOrName?: ((a: P, b: P) => boolean) | string,
        nameArg?: string,
    ) => {
        let resolvedName: string | undefined
        let resolvedAreEqual: ((a: P, b: P) => boolean) | undefined
        if (typeof areEqualOrName === "function") {
            resolvedAreEqual = areEqualOrName
            resolvedName = nameArg
        } else if (typeof areEqualOrName === "string") {
            resolvedName = areEqualOrName
        }
        const fam = instrumentedAtomFamily<P, A>(create, {
            name: resolvedName,
            skipRegistry: true,
            areEqual: resolvedAreEqual,
        })
        ownedFamilies.push(fam as unknown as ManagedFamily)
        return fam
    }

    // Rows selector atom family
    const rowsAtomFamily = atomFamily(
        (params: PaginatedControllerParams) =>
            atom((get) => {
                const rowsAtom = datasetStore.atoms.rowsAtom(params)
                return get(rowsAtom)
            }),
        (a, b) => paramsKey(a) === paramsKey(b),
        "paginatedEntity.rowsAtomFamily",
    )

    // Pagination state selector atom family
    const paginationAtomFamily = atomFamily(
        (params: PaginatedControllerParams) =>
            atom((get): PaginatedState => {
                const paginationAtom = datasetStore.atoms.paginationAtom(params)
                return get(paginationAtom)
            }),
        (a, b) => paramsKey(a) === paramsKey(b),
        "paginatedEntity.paginationAtomFamily",
    )

    // Selection atom family (uses underlying store's selection)
    const selectionAtomFamily = atomFamily(
        (params: PaginatedControllerParams) =>
            datasetStore.atoms.selectionAtom({scopeId: params.scopeId}),
        (a, b) => a.scopeId === b.scopeId,
        "paginatedEntity.selectionAtomFamily",
    )

    // Combined state atom family (rows + pagination) - read-only
    const stateAtomFamily = atomFamily(
        (params: PaginatedControllerParams) =>
            atom((get): PaginatedCombinedState<TRow> => {
                const rows = get(rowsAtomFamily(params))
                const pagination = get(paginationAtomFamily(params))
                return {
                    rows,
                    hasMore: pagination.hasMore,
                    isFetching: pagination.isFetching,
                    totalCount: pagination.totalCount,
                }
            }),
        (a, b) => paramsKey(a) === paramsKey(b),
        "paginatedEntity.stateAtomFamily",
    )

    // List counts atom family - unified count summary
    const listCountsAtomFamily = atomFamily(
        (params: PaginatedControllerParams) =>
            atom((get): EntityListCounts => {
                const rows = get(rowsAtomFamily(params))
                const pagination = get(paginationAtomFamily(params))

                // Count only countable rows (excludes skeletons by default)
                const loadedCount = rows.filter(isRowCountable).length
                const hasMore = pagination.hasMore
                const serverTotalCount = pagination.totalCount

                // Determine if total is known based on mode
                const isTotalKnown = totalCountMode === "total" && serverTotalCount !== null
                const effectiveTotalCount = isTotalKnown ? serverTotalCount : null

                // Compute display suffix
                const displaySuffix: "+" | "" = hasMore ? "+" : ""

                // Compute display labels
                let displayLabel: string
                let displayLabelShort: string

                // Short label is always just count + suffix
                displayLabelShort = `${loadedCount}${displaySuffix}`

                // Full label shows "x of y" when total is known and different
                if (
                    isTotalKnown &&
                    effectiveTotalCount !== null &&
                    effectiveTotalCount !== loadedCount
                ) {
                    displayLabel = `${loadedCount} of ${effectiveTotalCount}${displaySuffix}`
                } else {
                    displayLabel = displayLabelShort
                }

                return {
                    loadedCount,
                    totalCount: effectiveTotalCount,
                    hasMore,
                    isTotalKnown,
                    displayLabel,
                    displayLabelShort,
                    displaySuffix,
                }
            }),
        (a, b) => paramsKey(a) === paramsKey(b),
        "paginatedEntity.listCountsAtomFamily",
    )

    // Controller atom family - combines all state + dispatch
    const controllerAtomFamily = atomFamily(
        (params: PaginatedControllerParams) =>
            atom(
                (get): PaginatedControllerState<TRow> => {
                    const rows = get(rowsAtomFamily(params))
                    const pagination = get(paginationAtomFamily(params))
                    const selectedKeys = get(selectionAtomFamily(params))

                    return {
                        rows,
                        hasMore: pagination.hasMore,
                        isFetching: pagination.isFetching,
                        totalCount: pagination.totalCount,
                        selectedKeys,
                    }
                },
                (get, set, action: PaginatedControllerAction) => {
                    switch (action.type) {
                        case "refresh":
                            set(internalRefreshAtom, (prev) => prev + 1)
                            break

                        case "select":
                            set(selectionAtomFamily(params), action.keys)
                            break

                        case "selectAll": {
                            const rows = get(rowsAtomFamily(params))
                            const allKeys = rows
                                .filter((row) => !row.__isSkeleton)
                                .map((row) => row.key)
                            set(selectionAtomFamily(params), allKeys)
                            break
                        }

                        case "clearSelection":
                            set(selectionAtomFamily(params), [])
                            break

                        case "toggleSelection": {
                            const currentKeys = get(selectionAtomFamily(params))
                            const keyIndex = currentKeys.indexOf(action.key)
                            if (keyIndex === -1) {
                                set(selectionAtomFamily(params), [...currentKeys, action.key])
                            } else {
                                set(
                                    selectionAtomFamily(params),
                                    currentKeys.filter((_, i) => i !== keyIndex),
                                )
                            }
                            break
                        }
                    }
                },
            ),
        (a, b) => paramsKey(a) === paramsKey(b),
        "paginatedEntity.controllerAtomFamily",
    )

    return {
        entityName,
        store: datasetStore,
        rowHelpers,
        refreshAtom,
        metaAtom,
        invalidate,

        // Controller pattern
        controller: controllerAtomFamily,
        selectors: {
            state: stateAtomFamily,
            selection: selectionAtomFamily,
            listCounts: listCountsAtomFamily,
        },
        actions: {
            refresh: refreshAtom,
        },

        // Release every atomFamily entry this store + its underlying
        // infiniteTableStore own. After a long-running ETL pass that rotates
        // scopeId per iteration, call dispose() to release the accumulated
        // closures — otherwise heap grows ~50 KB per iteration from the
        // 13 internal atom families (6 here + 7 in createInfiniteTableStore).
        dispose() {
            let total = 0
            for (const f of ownedFamilies) {
                total += f.size()
                f.clear()
            }
            // Cascade into the table store
            const inner = (datasetStore as unknown as {dispose?: () => number})?.dispose
            if (typeof inner === "function") {
                total += inner.call(datasetStore)
            }
            return total
        },

        // Diagnostic: per-family active param counts for this store instance.
        familySizes() {
            const own = ownedFamilies.map((f) => ({name: f.name, size: f.size()}))
            const inner = (
                datasetStore as unknown as {
                    familySizes?: () => {name: string; size: number}[]
                }
            )?.familySizes
            return typeof inner === "function" ? [...own, ...inner.call(datasetStore)] : own
        },
    }
}

// ============================================================================
// TYPE HELPERS
// ============================================================================

/**
 * Type helper for extracting row type from a paginated store.
 */
export type PaginatedEntityRow<T> =
    T extends PaginatedEntityStore<infer TRow, unknown, BaseTableMeta> ? TRow : never

/**
 * Type helper for extracting meta type from a paginated store.
 */
export type PaginatedEntityMeta<T> =
    T extends PaginatedEntityStore<InfiniteTableRowBase, unknown, infer TMeta> ? TMeta : never
