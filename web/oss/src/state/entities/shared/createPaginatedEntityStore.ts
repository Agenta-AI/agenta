/**
 * Factory for creating paginated entity stores.
 *
 * This wraps the InfiniteVirtualTable's createSimpleTableStore with entity-specific
 * patterns to provide a unified API for paginated entity queries.
 *
 * ## Controller Pattern
 *
 * The paginated store includes a controller pattern for unified state access:
 *
 * ```ts
 * // Controller - unified state + dispatch
 * const [state, dispatch] = useAtom(testset.paginated.controller({
 *   scopeId: 'testsets-list',
 *   pageSize: 50,
 * }))
 *
 * // state.rows - array of rows
 * // state.totalCount - total count
 * // state.hasMore - whether more pages exist
 * // state.isFetching - loading state
 * // state.selectedKeys - selected row keys
 *
 * // dispatch({ type: 'loadNext' })
 * // dispatch({ type: 'refresh' })
 * // dispatch({ type: 'select', keys: [...] })
 * // dispatch({ type: 'clearSelection' })
 * ```
 *
 * ## Selectors
 *
 * For fine-grained subscriptions, use individual selectors:
 *
 * ```ts
 * const rows = useAtomValue(testset.paginated.selectors.rows({scopeId, pageSize}))
 * const pagination = useAtomValue(testset.paginated.selectors.pagination({scopeId, pageSize}))
 * ```
 *
 * ## Actions
 *
 * For imperative actions:
 *
 * ```ts
 * const refresh = useSetAtom(testset.paginated.actions.refresh)
 * refresh()
 * ```
 *
 * @example
 * ```ts
 * // In testset/paginatedStore.ts
 * export const testsetPaginatedStore = createPaginatedEntityStore({
 *   entityName: "testset",
 *   metaAtom: testsetPaginatedMetaAtom,
 *   fetchPage: async ({meta, limit, cursor}) => {
 *     const response = await fetchTestsetsWindow({
 *       projectId: meta.projectId!,
 *       limit,
 *       cursor,
 *     })
 *     return response
 *   },
 *   rowConfig: {
 *     getRowId: (row) => row.id,
 *     skeletonDefaults: {id: "", name: "", created_at: "", updated_at: ""},
 *   },
 * })
 *
 * // In controller
 * export const testset = {
 *   // ... existing
 *   paginated: testsetPaginatedStore,
 * }
 * ```
 */

import type {Key} from "react"

import {atom} from "jotai"
import type {Atom, PrimitiveAtom, WritableAtom} from "jotai"
import {atomFamily} from "jotai/utils"

import {
    createSimpleTableStore,
    type BaseTableMeta,
    type SimpleTableStore,
} from "@/oss/components/InfiniteVirtualTable/helpers/createSimpleTableStore"
import type {
    InfiniteTableFetchResult,
    InfiniteTableRowBase,
    WindowingState,
} from "@/oss/components/InfiniteVirtualTable/types"

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
     *
     * @example
     * ```ts
     * const refresh = useSetAtom(testset.paginated.refreshAtom)
     * refresh() // increments and triggers refetch
     * ```
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
     *
     * @example
     * ```ts
     * const [state, dispatch] = useAtom(testset.paginated.controller({
     *   scopeId: 'testsets-list',
     *   pageSize: 50,
     * }))
     *
     * // Read state
     * if (state.isFetching) return <Loading />
     * return state.rows.map(row => <Row key={row.key} data={row} />)
     *
     * // Dispatch actions
     * dispatch({ type: 'refresh' })
     * dispatch({ type: 'select', keys: ['id1', 'id2'] })
     * ```
     */
    controller: (
        params: PaginatedControllerParams,
    ) => WritableAtom<PaginatedControllerState<TRow>, [PaginatedControllerAction], void>

    /**
     * Selectors for fine-grained subscriptions
     *
     * Use when you only need a specific piece of state to minimize re-renders.
     */
    selectors: {
        /**
         * Rows atom - returns array of rows
         *
         * @example
         * ```ts
         * const rows = useAtomValue(testset.paginated.selectors.rows({scopeId, pageSize}))
         * ```
         */
        rows: (params: PaginatedControllerParams) => Atom<TRow[]>

        /**
         * Pagination state atom
         *
         * @example
         * ```ts
         * const {hasMore, isFetching} = useAtomValue(testset.paginated.selectors.pagination({scopeId, pageSize}))
         * ```
         */
        pagination: (params: PaginatedControllerParams) => Atom<PaginatedState>

        /**
         * Selection atom (read/write)
         *
         * @example
         * ```ts
         * const [selectedKeys, setSelectedKeys] = useAtom(testset.paginated.selectors.selection({scopeId, pageSize}))
         * ```
         */
        selection: (params: PaginatedControllerParams) => PrimitiveAtom<Key[]>
    }

    /**
     * Actions for imperative operations
     */
    actions: {
        /**
         * Refresh the paginated data
         *
         * @example
         * ```ts
         * const refresh = useSetAtom(testset.paginated.actions.refresh)
         * refresh()
         * ```
         */
        refresh: WritableAtom<number, [], void>
    }
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
    } = config

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
        // The refresh trigger will cause metaAtom to update,
        // which invalidates the query cache
    }

    // ========================================================================
    // CONTROLLER PATTERN IMPLEMENTATION
    // ========================================================================

    // Helper to create params key for atomFamily
    const paramsKey = (params: PaginatedControllerParams) => `${params.scopeId}:${params.pageSize}`

    // Rows selector atom family
    const rowsAtomFamily = atomFamily(
        (params: PaginatedControllerParams) =>
            atom((get) => {
                const rowsAtom = datasetStore.atoms.rowsAtom(params)
                return get(rowsAtom)
            }),
        (a, b) => paramsKey(a) === paramsKey(b),
    )

    // Pagination state selector atom family
    const paginationAtomFamily = atomFamily(
        (params: PaginatedControllerParams) =>
            atom((get): PaginatedState => {
                const paginationAtom = datasetStore.atoms.paginationAtom(params)
                return get(paginationAtom)
            }),
        (a, b) => paramsKey(a) === paramsKey(b),
    )

    // Selection atom family (uses underlying store's selection)
    const selectionAtomFamily = atomFamily(
        (params: PaginatedControllerParams) =>
            datasetStore.atoms.selectionAtom({scopeId: params.scopeId}),
        (a, b) => a.scopeId === b.scopeId,
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
            rows: rowsAtomFamily,
            pagination: paginationAtomFamily,
            selection: selectionAtomFamily,
        },
        actions: {
            refresh: refreshAtom,
        },
    }
}

// ============================================================================
// TYPE HELPERS
// ============================================================================

/**
 * Type helper for extracting row type from a paginated store
 */
export type PaginatedEntityRow<T> =
    T extends PaginatedEntityStore<infer TRow, any, any> ? TRow : never

/**
 * Type helper for extracting meta type from a paginated store
 */
export type PaginatedEntityMeta<T> =
    T extends PaginatedEntityStore<any, any, infer TMeta> ? TMeta : never
