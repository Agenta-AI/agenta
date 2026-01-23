/**
 * useHierarchicalSelection Hook
 *
 * Primitive hook for navigating hierarchical entity structures.
 * Handles breadcrumb navigation, level transitions, selection, and optional pagination.
 */

import {useMemo, useCallback, useEffect, useState, useRef} from "react"

import {atom, useAtomValue, useSetAtom, Atom} from "jotai"

import {resolveAdapter} from "../adapters/createAdapter"
import {
    selectionStateFamily,
    navigateDownFamily,
    navigateUpFamily,
    navigateToLevelFamily,
    resetSelectionFamily,
    setPathFamily,
    searchTermFamily,
    setSearchTermFamily,
} from "../state/selectionState"
import type {
    EntitySelectionAdapter,
    EntitySelectionResult,
    SelectionPathItem,
    HierarchyLevel,
    ListQueryState,
    PaginatedListQueryState,
    PaginationParams,
    PaginationInfo,
} from "../types"

// ============================================================================
// TYPES
// ============================================================================

export interface UseHierarchicalSelectionOptions<TSelection = EntitySelectionResult> {
    /**
     * Adapter or adapter name
     */
    adapter: EntitySelectionAdapter<TSelection> | string

    /**
     * Instance ID for state isolation
     */
    instanceId: string

    /**
     * Callback when selection is complete
     */
    onSelect?: (selection: TSelection) => void

    /**
     * Auto-select when only one option is available
     * @default false
     */
    autoSelectSingle?: boolean

    /**
     * Initial path (for restoring state)
     */
    initialPath?: SelectionPathItem[]

    /**
     * Enable pagination (uses paginated atoms from adapter if available)
     * @default false
     */
    paginated?: boolean

    /**
     * Page size for pagination
     * @default 50
     */
    pageSize?: number
}

export interface UseHierarchicalSelectionResult<TSelection = EntitySelectionResult> {
    /**
     * Current breadcrumb path
     */
    breadcrumb: SelectionPathItem[]

    /**
     * Current level index
     */
    currentLevel: number

    /**
     * Items at current level
     */
    items: unknown[]

    /**
     * Loading state
     */
    isLoading: boolean

    /**
     * Error state
     */
    error: Error | null

    /**
     * Whether at root level
     */
    isAtRoot: boolean

    /**
     * Whether at leaf (selectable) level
     */
    isAtLeaf: boolean

    /**
     * Whether auto-selection is about to occur (single item found, waiting for delay)
     */
    isAutoSelecting: boolean

    /**
     * Current level configuration
     */
    currentLevelConfig: HierarchyLevel<unknown> | null

    /**
     * Search term for current level
     */
    searchTerm: string

    /**
     * Set search term
     */
    setSearchTerm: (term: string) => void

    /**
     * Navigate into a child entity
     */
    navigateDown: (entity: unknown) => void

    /**
     * Navigate up one level
     */
    navigateUp: () => void

    /**
     * Navigate to a specific level by index
     */
    navigateToLevel: (level: number) => void

    /**
     * Select an entity (triggers onSelect callback)
     */
    select: (entity: unknown) => void

    /**
     * Check if an entity can be navigated into
     */
    canNavigateDown: (entity: unknown) => boolean

    /**
     * Check if an entity can be selected
     */
    canSelect: (entity: unknown) => boolean

    /**
     * Check if an entity is disabled
     */
    isDisabled: (entity: unknown) => boolean

    /**
     * Reset to initial state
     */
    reset: () => void

    /**
     * The resolved adapter
     */
    adapter: EntitySelectionAdapter<TSelection>

    // ========================================================================
    // PAGINATION PROPERTIES
    // ========================================================================

    /**
     * Whether current level supports pagination
     */
    supportsPagination: boolean

    /**
     * Whether there are more pages
     */
    hasNextPage: boolean

    /**
     * Whether currently fetching next page
     */
    isFetchingNextPage: boolean

    /**
     * Whether "load all" is in progress
     */
    isLoadingAll: boolean

    /**
     * Fetch next page of results
     */
    fetchNextPage: () => void

    /**
     * Load all remaining pages
     */
    loadAllPages: () => Promise<void>

    /**
     * Cancel ongoing "load all" operation
     */
    cancelLoadAll: () => void

    /**
     * Total count (if known from server)
     */
    totalCount: number | null

    /**
     * Current pagination info
     */
    pagination: PaginationInfo
}

// ============================================================================
// PAGINATION STATE
// ============================================================================

interface PaginationState {
    cursor: string | null
    offset: number
    pages: number
}

const initialPaginationState: PaginationState = {
    cursor: null,
    offset: 0,
    pages: 0,
}

// ============================================================================
// EMPTY ATOMS
// ============================================================================

const emptyListAtom = atom<ListQueryState<unknown>>({
    data: [],
    isPending: false,
    isError: false,
    error: null,
})

const emptyPaginatedAtom = atom<PaginatedListQueryState<unknown>>({
    data: [],
    isPending: false,
    isError: false,
    error: null,
    pagination: {
        hasNextPage: false,
        nextCursor: null,
        nextOffset: null,
        totalCount: null,
        isFetchingNextPage: false,
    },
})

const emptyPagination: PaginationInfo = {
    hasNextPage: false,
    nextCursor: null,
    nextOffset: null,
    totalCount: null,
    isFetchingNextPage: false,
}

// ============================================================================
// DEFAULT FILTER
// ============================================================================

function defaultFilter<T>(items: T[], searchTerm: string): T[] {
    if (!searchTerm.trim()) return items
    const term = searchTerm.toLowerCase().trim()
    return items.filter((item) => JSON.stringify(item).toLowerCase().includes(term))
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook for navigating hierarchical entity structures with optional pagination support
 *
 * @example
 * ```typescript
 * // Basic usage (non-paginated)
 * const {
 *   breadcrumb,
 *   items,
 *   navigateDown,
 *   select,
 *   isAtLeaf
 * } = useHierarchicalSelection({
 *   adapter: appRevisionAdapter,
 *   instanceId: 'selector-1',
 *   onSelect: (selection) => console.log('Selected:', selection),
 * })
 *
 * // With pagination
 * const {
 *   items,
 *   hasNextPage,
 *   fetchNextPage,
 *   loadAllPages,
 * } = useHierarchicalSelection({
 *   adapter: testsetAdapter,
 *   instanceId: 'selector-1',
 *   paginated: true,
 *   pageSize: 25,
 * })
 * ```
 */
export function useHierarchicalSelection<TSelection = EntitySelectionResult>(
    options: UseHierarchicalSelectionOptions<TSelection>,
): UseHierarchicalSelectionResult<TSelection> {
    const {
        adapter: adapterOrName,
        instanceId,
        onSelect,
        autoSelectSingle = false,
        initialPath,
        paginated = false,
        pageSize = 50,
    } = options

    // Resolve adapter
    const adapter = useMemo(() => resolveAdapter(adapterOrName), [adapterOrName])

    // ========================================================================
    // NAVIGATION STATE (from molecules)
    // ========================================================================

    const stateAtom = useMemo(() => selectionStateFamily(instanceId), [instanceId])
    const navigateDownAtom = useMemo(() => navigateDownFamily(instanceId), [instanceId])
    const navigateUpAtom = useMemo(() => navigateUpFamily(instanceId), [instanceId])
    const navigateToLevelAtom = useMemo(() => navigateToLevelFamily(instanceId), [instanceId])
    const resetAtom = useMemo(() => resetSelectionFamily(instanceId), [instanceId])
    const setPathAtom = useMemo(() => setPathFamily(instanceId), [instanceId])

    const state = useAtomValue(stateAtom)

    const dispatchNavigateDown = useSetAtom(navigateDownAtom)
    const dispatchNavigateUp = useSetAtom(navigateUpAtom)
    const dispatchNavigateToLevel = useSetAtom(navigateToLevelAtom)
    const dispatchReset = useSetAtom(resetAtom)
    const dispatchSetPath = useSetAtom(setPathAtom)

    // Initialize with initial path
    useEffect(() => {
        if (initialPath && initialPath.length > 0 && state.currentPath.length === 0) {
            dispatchSetPath(initialPath)
        }
    }, [initialPath, state.currentPath.length, dispatchSetPath])

    // ========================================================================
    // SEARCH STATE
    // ========================================================================

    const searchTermAtom = useMemo(() => searchTermFamily(instanceId), [instanceId])
    const setSearchTermAtom = useMemo(() => setSearchTermFamily(instanceId), [instanceId])

    const searchTerm = useAtomValue(searchTermAtom)
    const dispatchSetSearchTerm = useSetAtom(setSearchTermAtom)

    const setSearchTerm = useCallback(
        (term: string) => dispatchSetSearchTerm(term),
        [dispatchSetSearchTerm],
    )

    // ========================================================================
    // CURRENT LEVEL CONFIG
    // ========================================================================

    const currentLevelConfig = useMemo(() => {
        const {levels} = adapter.hierarchy
        if (state.currentLevel >= levels.length) return null
        return levels[state.currentLevel]
    }, [adapter.hierarchy, state.currentLevel])

    // Check if current level supports pagination
    const supportsPagination = useMemo(() => {
        if (!paginated || !currentLevelConfig) return false
        return !!(
            currentLevelConfig.paginatedListAtom || currentLevelConfig.paginatedListAtomFamily
        )
    }, [paginated, currentLevelConfig])

    // ========================================================================
    // PAGINATION STATE
    // ========================================================================

    const [paginationState, setPaginationState] = useState<PaginationState>(initialPaginationState)
    const [allItems, setAllItems] = useState<unknown[]>([])

    // Load all state
    const [isLoadingAll, setIsLoadingAll] = useState(false)
    const loadAllCancelledRef = useRef(false)

    // Reset pagination when level or search changes
    useEffect(() => {
        setPaginationState(initialPaginationState)
        setAllItems([])
    }, [state.currentLevel, searchTerm])

    // ========================================================================
    // LIST ATOMS
    // ========================================================================

    // Non-paginated list atom
    const nonPaginatedListAtom = useMemo((): Atom<ListQueryState<unknown>> => {
        if (!currentLevelConfig) return emptyListAtom

        const {listAtom, listAtomFamily} = currentLevelConfig

        if (state.currentLevel === 0 && listAtom) {
            return listAtom
        }

        if (listAtomFamily && state.currentPath.length > 0) {
            const parentId = state.currentPath[state.currentPath.length - 1]?.id
            if (parentId) {
                return listAtomFamily(parentId)
            }
        }

        if (listAtom) {
            return listAtom
        }

        return emptyListAtom
    }, [currentLevelConfig, state.currentLevel, state.currentPath])

    // Paginated list atom
    const paginatedListAtom = useMemo((): Atom<PaginatedListQueryState<unknown>> => {
        if (!supportsPagination || !currentLevelConfig) return emptyPaginatedAtom

        const {paginatedListAtom: paginatedAtomFactory, paginatedListAtomFamily} =
            currentLevelConfig

        const params: PaginationParams = {
            pageSize,
            cursor: paginationState.cursor,
            offset: paginationState.offset,
            searchTerm: currentLevelConfig.supportsServerSearch ? searchTerm : undefined,
        }

        if (state.currentLevel === 0 && paginatedAtomFactory) {
            return paginatedAtomFactory(params)
        }

        if (paginatedListAtomFamily && state.currentPath.length > 0) {
            const parentId = state.currentPath[state.currentPath.length - 1]?.id
            if (parentId) {
                return paginatedListAtomFamily(parentId, params)
            }
        }

        if (paginatedAtomFactory) {
            return paginatedAtomFactory(params)
        }

        return emptyPaginatedAtom
    }, [
        supportsPagination,
        currentLevelConfig,
        state.currentLevel,
        state.currentPath,
        pageSize,
        paginationState.cursor,
        paginationState.offset,
        searchTerm,
    ])

    // ========================================================================
    // QUERY RESULTS
    // ========================================================================

    const nonPaginatedQuery = useAtomValue(nonPaginatedListAtom)
    const paginatedQuery = useAtomValue(paginatedListAtom)

    // Accumulate paginated items
    useEffect(() => {
        if (!supportsPagination) return

        const data = paginatedQuery.data
        if (data && !paginatedQuery.isPending) {
            if (paginationState.pages === 0) {
                setAllItems(data)
            } else {
                setAllItems((prev) => {
                    const existingIds = new Set(prev.map((item) => JSON.stringify(item)))
                    const newItems = data.filter((item) => !existingIds.has(JSON.stringify(item)))
                    return [...prev, ...newItems]
                })
            }
        }
    }, [supportsPagination, paginatedQuery.data, paginatedQuery.isPending, paginationState.pages])

    // ========================================================================
    // DERIVED STATE
    // ========================================================================

    const {items, isLoading, error, pagination} = useMemo(() => {
        if (supportsPagination) {
            // Paginated mode
            const baseItems = allItems
            const filteredItems =
                currentLevelConfig?.supportsServerSearch !== true
                    ? defaultFilter(baseItems, searchTerm)
                    : baseItems

            const paginationInfo = paginatedQuery.pagination ?? emptyPagination

            return {
                items: filteredItems,
                isLoading: paginatedQuery.isPending && paginationState.pages === 0,
                error: paginatedQuery.isError
                    ? (paginatedQuery.error ?? new Error("Unknown error"))
                    : null,
                pagination: {
                    ...paginationInfo,
                    isFetchingNextPage: paginatedQuery.isPending && paginationState.pages > 0,
                },
            }
        } else {
            // Non-paginated mode
            const data = nonPaginatedQuery.data ?? []
            const filteredItems = defaultFilter(data, searchTerm)

            return {
                items: filteredItems,
                isLoading: nonPaginatedQuery.isPending,
                error: nonPaginatedQuery.isError
                    ? (nonPaginatedQuery.error ?? new Error("Unknown error"))
                    : null,
                pagination: emptyPagination,
            }
        }
    }, [
        supportsPagination,
        allItems,
        searchTerm,
        currentLevelConfig?.supportsServerSearch,
        paginatedQuery,
        paginationState.pages,
        nonPaginatedQuery,
    ])

    const isAtRoot = state.currentLevel === 0
    const selectableLevel = adapter.hierarchy.selectableLevel ?? adapter.hierarchy.levels.length - 1
    const isAtLeaf = state.currentLevel >= selectableLevel
    const hasNextPage = pagination.hasNextPage
    const isFetchingNextPage = pagination.isFetchingNextPage
    const totalCount = pagination.totalCount

    // ========================================================================
    // PAGINATION ACTIONS
    // ========================================================================

    const fetchNextPage = useCallback(() => {
        if (!supportsPagination || !hasNextPage || isFetchingNextPage) return

        setPaginationState((prev) => ({
            cursor: pagination.nextCursor,
            offset: pagination.nextOffset ?? prev.offset + pageSize,
            pages: prev.pages + 1,
        }))
    }, [supportsPagination, hasNextPage, isFetchingNextPage, pagination, pageSize])

    const loadAllPages = useCallback(async () => {
        if (!supportsPagination || isLoadingAll || !hasNextPage) return

        setIsLoadingAll(true)
        loadAllCancelledRef.current = false

        return new Promise<void>((resolve, reject) => {
            const intervalId = setInterval(() => {
                if (loadAllCancelledRef.current || !pagination.hasNextPage) {
                    clearInterval(intervalId)
                    setIsLoadingAll(false)
                    resolve()
                } else if (!isFetchingNextPage && pagination.hasNextPage) {
                    fetchNextPage()
                }
            }, 100)

            setTimeout(
                () => {
                    clearInterval(intervalId)
                    setIsLoadingAll(false)
                    reject(new Error("Load all timed out after 5 minutes"))
                },
                5 * 60 * 1000,
            )
        })
    }, [
        supportsPagination,
        isLoadingAll,
        hasNextPage,
        isFetchingNextPage,
        pagination,
        fetchNextPage,
    ])

    const cancelLoadAll = useCallback(() => {
        loadAllCancelledRef.current = true
        setIsLoadingAll(false)
    }, [])

    // ========================================================================
    // HELPER FUNCTIONS
    // ========================================================================

    const canNavigateDown = useCallback(
        (entity: unknown): boolean => {
            if (!currentLevelConfig) return false
            const hasChildren = currentLevelConfig.hasChildren?.(entity) ?? true
            return hasChildren && state.currentLevel < adapter.hierarchy.levels.length - 1
        },
        [currentLevelConfig, state.currentLevel, adapter.hierarchy.levels.length],
    )

    const canSelect = useCallback(
        (entity: unknown): boolean => {
            if (!currentLevelConfig) return false
            return currentLevelConfig.isSelectable?.(entity) ?? isAtLeaf
        },
        [currentLevelConfig, isAtLeaf],
    )

    const isDisabledFn = useCallback(
        (entity: unknown): boolean => {
            if (!currentLevelConfig) return false
            return currentLevelConfig.isDisabled?.(entity) ?? false
        },
        [currentLevelConfig],
    )

    // ========================================================================
    // NAVIGATION ACTIONS
    // ========================================================================

    const navigateDown = useCallback(
        (entity: unknown) => {
            if (!currentLevelConfig || !canNavigateDown(entity)) return

            const pathItem: SelectionPathItem = {
                type: currentLevelConfig.type,
                id: currentLevelConfig.getId(entity),
                label: currentLevelConfig.getLabel(entity),
            }

            dispatchNavigateDown(pathItem)
        },
        [currentLevelConfig, canNavigateDown, dispatchNavigateDown],
    )

    const navigateUp = useCallback(() => {
        dispatchNavigateUp()
    }, [dispatchNavigateUp])

    const navigateToLevel = useCallback(
        (level: number) => {
            dispatchNavigateToLevel(level)
        },
        [dispatchNavigateToLevel],
    )

    const reset = useCallback(() => {
        dispatchReset()
        setPaginationState(initialPaginationState)
        setAllItems([])
    }, [dispatchReset])

    // ========================================================================
    // SELECTION
    // ========================================================================

    const select = useCallback(
        (entity: unknown) => {
            if (!currentLevelConfig || !canSelect(entity)) return

            const pathItem: SelectionPathItem = {
                type: currentLevelConfig.type,
                id: currentLevelConfig.getId(entity),
                label: currentLevelConfig.getLabel(entity),
            }

            const fullPath = [...state.currentPath, pathItem]
            const selection = adapter.toSelection(fullPath, entity)

            onSelect?.(selection)
        },
        [currentLevelConfig, canSelect, state.currentPath, adapter, onSelect],
    )

    // ========================================================================
    // AUTO-SELECT (immediate when single item)
    // ========================================================================

    // Track if we're in auto-selection flow (for UI feedback if needed)
    const [isAutoSelecting, setIsAutoSelecting] = useState(false)

    // Reset auto-selecting state when items change
    useEffect(() => {
        if (items.length !== 1 || isLoading) {
            setIsAutoSelecting(false)
        }
    }, [items.length, isLoading])

    useEffect(() => {
        if (!autoSelectSingle || isLoading || items.length !== 1) return

        const singleItem = items[0]
        const canAutoSelect = canSelect(singleItem) && !isDisabledFn(singleItem)
        const canAutoNavigate = canNavigateDown(singleItem) && !isDisabledFn(singleItem)

        if (!canAutoSelect && !canAutoNavigate) return

        // Set state for UI feedback
        setIsAutoSelecting(true)

        // Auto-select/navigate immediately
        if (canAutoSelect) {
            select(singleItem)
        } else if (canAutoNavigate) {
            navigateDown(singleItem)
        }

        setIsAutoSelecting(false)
    }, [
        autoSelectSingle,
        isLoading,
        items,
        canSelect,
        isDisabledFn,
        select,
        canNavigateDown,
        navigateDown,
    ])

    // ========================================================================
    // RETURN
    // ========================================================================

    return {
        // Navigation
        breadcrumb: state.currentPath,
        currentLevel: state.currentLevel,
        items,
        isLoading,
        error,
        isAtRoot,
        isAtLeaf,
        isAutoSelecting,
        currentLevelConfig,
        searchTerm,
        setSearchTerm,
        navigateDown,
        navigateUp,
        navigateToLevel,
        select,
        canNavigateDown,
        canSelect,
        isDisabled: isDisabledFn,
        reset,
        adapter,

        // Pagination
        supportsPagination,
        hasNextPage,
        isFetchingNextPage,
        isLoadingAll,
        fetchNextPage,
        loadAllPages,
        cancelLoadAll,
        totalCount,
        pagination,
    }
}
