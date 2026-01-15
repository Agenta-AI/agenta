/**
 * useEntityTableState - Common patterns for entity tables
 *
 * This hook standardizes the common patterns used across entity tables
 * (TestsetsTable, TestcasesTable, EvaluationRunsTable, etc.)
 *
 * ## When to Use This Hook
 *
 * **Use this hook** for simple entity tables that need:
 * - Basic rows + pagination state
 * - Checkbox-style selection
 * - Standard row click handling
 * - Integration with InfiniteVirtualTableFeatureShell
 *
 * **Use selectors directly** for complex tables that need:
 * - Tree data with expandable rows
 * - Multiple selection modes (checkbox + radio)
 * - Custom selection logic (e.g., select across parent/child rows)
 * - Heavy customization beyond standard patterns
 *
 * @example Simple table with hook
 * ```tsx
 * const {
 *   rows,
 *   isFetching,
 *   hasMore,
 *   selectedKeys,
 *   setSelectedKeys,
 *   clearSelection,
 *   buildRowHandlers,
 *   tableScope,
 * } = useEntityTableState({
 *   paginatedStore: testsetMolecule.paginated,
 *   scopeId: `testsets-${projectId}`,
 *   pageSize: 50,
 *   onRowClick: (record) => router.push(`/testsets/${record.id}`),
 * })
 * ```
 *
 * @example Complex table with direct selectors
 * ```tsx
 * // Memoize params to prevent re-renders
 * const paginatedParams = useMemo(() => ({scopeId, pageSize: 50}), [scopeId])
 *
 * // Use selectors.state() for combined rows + pagination
 * const stateAtom = useMemo(
 *   () => store.selectors.state(paginatedParams),
 *   [paginatedParams],
 * )
 * const {rows, isFetching, hasMore} = useAtomValue(stateAtom)
 *
 * // Use selectors.selection() for selection state
 * const selectionAtom = useMemo(
 *   () => store.selectors.selection(paginatedParams),
 *   [paginatedParams],
 * )
 * const [selectedKeys, setSelectedKeys] = useAtom(selectionAtom)
 * ```
 */

import type {CSSProperties, Key, MouseEvent} from "react"
import {useCallback, useMemo} from "react"

import {useAtom, useAtomValue} from "jotai"

import type {TableScopeConfig} from "../features/InfiniteVirtualTableFeatureShell"
import type {
    PaginatedCombinedState,
    PaginatedControllerParams,
    PaginatedEntityStore,
} from "../paginated/createPaginatedEntityStore"
import type {InfiniteTableRowBase} from "../types"

// ============================================================================
// TYPES
// ============================================================================

export interface UseEntityTableStateOptions<TRow extends InfiniteTableRowBase> {
    /**
     * Paginated store from entity molecule
     * e.g., testsetMolecule.paginated
     */
    paginatedStore: PaginatedEntityStore<TRow, any, any>

    /**
     * Unique scope identifier for this table instance
     * e.g., `testsets-${projectId}` or `testcases-${revisionId}`
     */
    scopeId: string

    /**
     * Number of rows per page (default: 50)
     */
    pageSize?: number

    /**
     * Whether to enable infinite scroll (default: true)
     */
    enableInfiniteScroll?: boolean

    /**
     * Row click handler - called when a non-skeleton row is clicked
     * (excluding interactive elements)
     */
    onRowClick?: (record: TRow) => void

    /**
     * Default row height in pixels (default: 48)
     */
    rowHeight?: number

    /**
     * Additional interactive element selectors to exclude from row click
     */
    excludeClickSelectors?: string[]
}

export interface UseEntityTableStateResult<TRow extends InfiniteTableRowBase> {
    /**
     * Array of rows (includes skeletons during loading)
     */
    rows: TRow[]

    /**
     * Whether currently fetching data
     */
    isFetching: boolean

    /**
     * Whether more pages exist
     */
    hasMore: boolean

    /**
     * Total count of rows (if known)
     */
    totalCount: number | null

    /**
     * Currently selected row keys
     */
    selectedKeys: Key[]

    /**
     * Set selected row keys
     */
    setSelectedKeys: (keys: Key[]) => void

    /**
     * Clear all selected rows
     */
    clearSelection: () => void

    /**
     * Build row event handlers for table's onRow prop
     */
    buildRowHandlers: (record: TRow) => {
        onClick: (event: MouseEvent<HTMLTableRowElement>) => void
        className: string
        style: CSSProperties
    }

    /**
     * Table scope configuration for InfiniteVirtualTableFeatureShell
     */
    tableScope: TableScopeConfig

    /**
     * Params for paginated store selectors
     */
    paginatedParams: PaginatedControllerParams

    /**
     * Refresh the table data
     */
    refresh: () => void
}

// ============================================================================
// DEFAULT INTERACTIVE SELECTORS
// ============================================================================

/**
 * Default selectors for interactive elements that should not trigger row click
 */
const DEFAULT_INTERACTIVE_SELECTORS = [
    "button",
    "a",
    ".ant-dropdown-trigger",
    ".ant-checkbox-wrapper",
    ".ant-select",
    "input",
    "textarea",
    "[role='button']",
    "[data-interactive]",
]

// ============================================================================
// HOOK
// ============================================================================

export function useEntityTableState<TRow extends InfiniteTableRowBase>(
    options: UseEntityTableStateOptions<TRow>,
): UseEntityTableStateResult<TRow> {
    const {
        paginatedStore,
        scopeId,
        pageSize = 50,
        enableInfiniteScroll = true,
        onRowClick,
        rowHeight = 48,
        excludeClickSelectors = [],
    } = options

    // Memoize params to prevent unnecessary re-renders
    const paginatedParams = useMemo(() => ({scopeId, pageSize}), [scopeId, pageSize])

    // Combined state selector (rows + pagination)
    const stateAtom = useMemo(
        () => paginatedStore.selectors.state(paginatedParams),
        [paginatedStore, paginatedParams],
    )
    const state = useAtomValue(stateAtom) as PaginatedCombinedState<TRow>

    // Selection state from store
    const selectionAtom = useMemo(
        () => paginatedStore.selectors.selection(paginatedParams),
        [paginatedStore, paginatedParams],
    )
    const [selectedKeys, setSelectedKeys] = useAtom(selectionAtom)

    // Clear selection helper
    const clearSelection = useCallback(() => {
        setSelectedKeys([])
    }, [setSelectedKeys])

    // Combine selectors for interactive elements
    const interactiveSelectors = useMemo(
        () => [...DEFAULT_INTERACTIVE_SELECTORS, ...excludeClickSelectors],
        [excludeClickSelectors],
    )

    // Build row handlers for click events
    const buildRowHandlers = useCallback(
        (record: TRow) => {
            const isNavigable = !record.__isSkeleton

            return {
                onClick: (event: MouseEvent<HTMLTableRowElement>) => {
                    if (!isNavigable || !onRowClick) return

                    // Check if clicking on interactive elements
                    const target = event.target as HTMLElement
                    const isInteractive = interactiveSelectors.some((selector) =>
                        target.closest(selector),
                    )
                    if (isInteractive) return

                    onRowClick(record)
                },
                className: "entity-table__row",
                style: {
                    cursor: isNavigable && onRowClick ? "pointer" : "default",
                    height: rowHeight,
                    minHeight: rowHeight,
                } as CSSProperties,
            }
        },
        [onRowClick, rowHeight, interactiveSelectors],
    )

    // Table scope configuration
    const tableScope = useMemo(
        (): TableScopeConfig => ({
            scopeId,
            pageSize,
            enableInfiniteScroll,
        }),
        [scopeId, pageSize, enableInfiniteScroll],
    )

    // Refresh function
    const refresh = useCallback(() => {
        paginatedStore.invalidate()
    }, [paginatedStore])

    return {
        // State
        rows: state.rows,
        isFetching: state.isFetching,
        hasMore: state.hasMore,
        totalCount: state.totalCount,

        // Selection
        selectedKeys,
        setSelectedKeys,
        clearSelection,

        // Row handlers
        buildRowHandlers,

        // Config
        tableScope,
        paginatedParams,

        // Actions
        refresh,
    }
}

export default useEntityTableState
