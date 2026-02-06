/**
 * useBreadcrumbMode Hook
 *
 * Breadcrumb navigation mode where one level is visible at a time.
 * User navigates through hierarchy via drilling down and breadcrumb navigation.
 *
 * Pattern: Show Apps → Click App → Show Variants → Click Variant → Show Revisions
 *
 * Used by EntityPicker with breadcrumb navigation.
 */

import {useCallback, useEffect, useMemo, useState, useRef} from "react"

import {computeListCounts, type EntityListCounts} from "@agenta/entities/shared"
import {useAtomValue, useSetAtom} from "jotai"

import {
    selectionStateFamily,
    navigateDownFamily,
    navigateUpFamily,
    navigateToLevelFamily,
    resetSelectionFamily,
    setPathFamily,
    searchTermFamily,
    setSearchTermFamily,
} from "../../state/selectionState"
import type {
    EntitySelectionAdapter,
    EntitySelectionResult,
    HierarchyLevel,
    SelectionPathItem,
    PaginationInfo,
} from "../../types"
import {
    useEntitySelectionCore,
    getLevelLabel,
    type EntitySelectionCoreOptions,
} from "../useEntitySelectionCore"
import {useLevelData, usePaginatedLevelData, filterItems, buildPathItem} from "../utilities"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for useBreadcrumbMode
 */
export interface UseBreadcrumbModeOptions<
    TSelection = EntitySelectionResult,
> extends EntitySelectionCoreOptions<TSelection> {
    /**
     * Initial path (for restoring state)
     */
    initialPath?: SelectionPathItem[]

    /**
     * Enable pagination for large lists
     * @default false
     */
    paginated?: boolean

    /**
     * Page size for pagination
     * @default 50
     */
    pageSize?: number

    /**
     * Global auto-select setting (applies to all levels unless overridden)
     * @default false
     */
    autoSelectSingle?: boolean
}

/**
 * Result from useBreadcrumbMode
 */
export interface UseBreadcrumbModeResult<TSelection = EntitySelectionResult> {
    // Navigation state
    /** Current breadcrumb path */
    breadcrumb: SelectionPathItem[]
    /** Current level index */
    currentLevel: number
    /** Items at current level */
    items: unknown[]
    /** Whether loading */
    isLoading: boolean
    /** Error if any */
    error: Error | null
    /** Whether at root level */
    isAtRoot: boolean
    /** Whether at leaf (selectable) level */
    isAtLeaf: boolean
    /** Whether auto-selection is pending */
    isAutoSelecting: boolean
    /** Current level configuration */
    currentLevelConfig: HierarchyLevel<unknown> | null
    /** Current level label */
    currentLevelLabel: string

    // Search
    /** Search term for filtering */
    searchTerm: string
    /** Set search term */
    setSearchTerm: (term: string) => void

    // Navigation actions
    /** Navigate into a child entity */
    navigateDown: (entity: unknown) => void
    /** Navigate up one level */
    navigateUp: () => void
    /** Navigate to a specific level by index */
    navigateToLevel: (level: number) => void
    /** Select an entity (triggers onSelect) */
    select: (entity: unknown) => void
    /** Reset to initial state */
    reset: () => void

    // Item helpers
    /** Check if entity can be navigated into */
    canNavigateDown: (entity: unknown) => boolean
    /** Check if entity can be selected */
    canSelect: (entity: unknown) => boolean
    /** Check if entity is disabled */
    isDisabled: (entity: unknown) => boolean

    // Pagination (when enabled)
    /** Whether current level supports pagination */
    supportsPagination: boolean
    /** Whether there are more pages */
    hasNextPage: boolean
    /** Whether fetching next page */
    isFetchingNextPage: boolean
    /** Whether loading all pages */
    isLoadingAll: boolean
    /** Fetch next page */
    fetchNextPage: () => void
    /** Load all remaining pages */
    loadAllPages: () => Promise<void>
    /** Cancel load all */
    cancelLoadAll: () => void
    /** Total count if known */
    totalCount: number | null
    /** Pagination info */
    pagination: PaginationInfo
    /** Unified list counts (for LoadMoreButton/LoadAllButton) */
    counts: EntityListCounts

    // Core
    /** Resolved adapter */
    adapter: EntitySelectionAdapter<TSelection>
    /** Instance ID */
    instanceId: string
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

const emptyPagination: PaginationInfo = {
    hasNextPage: false,
    nextCursor: null,
    nextOffset: null,
    totalCount: null,
    isFetchingNextPage: false,
}

// ============================================================================
// HOOK: useBreadcrumbMode
// ============================================================================

/**
 * Hook for breadcrumb navigation mode.
 *
 * Shows one level at a time with breadcrumb trail for navigation.
 * Supports pagination for large lists.
 *
 * @example
 * ```typescript
 * const {
 *     breadcrumb,
 *     items,
 *     navigateDown,
 *     navigateUp,
 *     select,
 *     isAtLeaf,
 * } = useBreadcrumbMode({
 *     adapter: "appRevision",
 *     onSelect: handleSelect,
 *     paginated: true,
 * })
 *
 * // Render breadcrumb
 * <Breadcrumb>
 *     {breadcrumb.map((item, i) => (
 *         <Breadcrumb.Item onClick={() => navigateToLevel(i)}>
 *             {item.label}
 *         </Breadcrumb.Item>
 *     ))}
 * </Breadcrumb>
 *
 * // Render items
 * {items.map(item => (
 *     <ListItem
 *         onClick={() => canNavigateDown(item) ? navigateDown(item) : select(item)}
 *     />
 * ))}
 * ```
 */
export function useBreadcrumbMode<TSelection = EntitySelectionResult>(
    options: UseBreadcrumbModeOptions<TSelection>,
): UseBreadcrumbModeResult<TSelection> {
    const {
        onSelect,
        initialPath,
        paginated = false,
        pageSize = 50,
        autoSelectSingle = false,
    } = options

    // Get core utilities
    const {
        adapter,
        hierarchyLevels,
        instanceId,
        selectableLevel,
        shouldAutoSelectAtLevel,
        createSelection,
    } = useEntitySelectionCore(options)

    // ========================================================================
    // NAVIGATION STATE (from selectionState atoms)
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
        if (state.currentLevel >= hierarchyLevels.length) return null
        return hierarchyLevels[state.currentLevel]
    }, [hierarchyLevels, state.currentLevel])

    const currentLevelLabel = currentLevelConfig ? getLevelLabel(currentLevelConfig) : "items"

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
    const [isLoadingAll, setIsLoadingAll] = useState(false)
    const loadAllCancelledRef = useRef(false)

    // Reset pagination when level or search changes
    useEffect(() => {
        setPaginationState(initialPaginationState)
        setAllItems([])
    }, [state.currentLevel, searchTerm])

    // ========================================================================
    // DATA FETCHING
    // ========================================================================

    const parentId =
        state.currentPath.length > 0
            ? (state.currentPath[state.currentPath.length - 1]?.id ?? null)
            : null

    // Non-paginated data
    const nonPaginatedData = useLevelData({
        levelConfig: currentLevelConfig!,
        parentId: state.currentLevel === 0 ? null : parentId,
        isEnabled: !!currentLevelConfig,
    })

    // Paginated data
    const paginatedData = usePaginatedLevelData({
        levelConfig: currentLevelConfig!,
        parentId: state.currentLevel === 0 ? null : parentId,
        isEnabled: !!currentLevelConfig && supportsPagination,
        paginationParams: {
            pageSize,
            cursor: paginationState.cursor,
            offset: paginationState.offset,
            searchTerm: currentLevelConfig?.supportsServerSearch ? searchTerm : undefined,
        },
    })

    // Accumulate paginated items
    useEffect(() => {
        if (!supportsPagination) return

        const data = paginatedData.items
        if (data.length > 0 && !paginatedData.query.isPending) {
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
    }, [
        supportsPagination,
        paginatedData.items,
        paginatedData.query.isPending,
        paginationState.pages,
    ])

    // ========================================================================
    // DERIVED STATE
    // ========================================================================

    const {items, isLoading, error, pagination} = useMemo(() => {
        if (supportsPagination) {
            const baseItems = allItems
            const filteredItems =
                currentLevelConfig?.supportsServerSearch !== true
                    ? filterItems(baseItems, searchTerm)
                    : baseItems

            return {
                items: filteredItems,
                isLoading: paginatedData.query.isPending && paginationState.pages === 0,
                error: paginatedData.query.isError
                    ? (paginatedData.query.error ?? new Error("Unknown error"))
                    : null,
                pagination: {
                    hasNextPage: paginatedData.hasNextPage,
                    nextCursor: paginatedData.nextCursor,
                    nextOffset: paginatedData.nextOffset,
                    totalCount: paginatedData.totalCount,
                    isFetchingNextPage: paginatedData.query.isPending && paginationState.pages > 0,
                },
            }
        } else {
            const data = nonPaginatedData.items
            const filteredItems = filterItems(data, searchTerm)

            return {
                items: filteredItems,
                isLoading: nonPaginatedData.query.isPending,
                error: nonPaginatedData.query.isError
                    ? (nonPaginatedData.query.error ?? new Error("Unknown error"))
                    : null,
                pagination: emptyPagination,
            }
        }
    }, [
        supportsPagination,
        allItems,
        searchTerm,
        currentLevelConfig?.supportsServerSearch,
        paginatedData,
        paginationState.pages,
        nonPaginatedData,
    ])

    const isAtRoot = state.currentLevel === 0
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

    /**
     * Start loading all remaining pages.
     * Uses React-idiomatic approach: sets a flag that triggers an effect
     * to automatically fetch subsequent pages as they complete.
     */
    const loadAllPages = useCallback(async () => {
        if (!supportsPagination || isLoadingAll || !hasNextPage) return

        setIsLoadingAll(true)
        loadAllCancelledRef.current = false

        // Trigger first fetch - the effect below will continue loading
        fetchNextPage()
    }, [supportsPagination, isLoadingAll, hasNextPage, fetchNextPage])

    /**
     * Effect to automatically fetch next pages when isLoadingAll is true.
     * This replaces the timeout-based polling with a React-idiomatic approach.
     */
    useEffect(() => {
        // Only run when we're in "load all" mode
        if (!isLoadingAll) return

        // Check if we should stop
        if (loadAllCancelledRef.current) {
            setIsLoadingAll(false)
            return
        }

        // No more pages - we're done
        if (!pagination.hasNextPage) {
            setIsLoadingAll(false)
            return
        }

        // Currently fetching - wait for completion
        if (isFetchingNextPage) {
            return
        }

        // Not fetching and more pages exist - fetch next page
        fetchNextPage()
    }, [isLoadingAll, pagination.hasNextPage, isFetchingNextPage, fetchNextPage])

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
            return hasChildren && state.currentLevel < hierarchyLevels.length - 1
        },
        [currentLevelConfig, state.currentLevel, hierarchyLevels.length],
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
            const pathItem = buildPathItem(entity, currentLevelConfig)
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

            const pathItem = buildPathItem(entity, currentLevelConfig)
            const fullPath = [...state.currentPath, pathItem]
            const selection = createSelection(fullPath, entity)

            onSelect?.(selection)
        },
        [currentLevelConfig, canSelect, state.currentPath, createSelection, onSelect],
    )

    // ========================================================================
    // AUTO-SELECT
    // ========================================================================

    const [isAutoSelecting, setIsAutoSelecting] = useState(false)

    // Reset auto-selecting state when items change
    useEffect(() => {
        if (items.length !== 1 || isLoading) {
            setIsAutoSelecting(false)
        }
    }, [items.length, isLoading])

    // Perform auto-select
    const shouldAutoSelect = autoSelectSingle || shouldAutoSelectAtLevel(state.currentLevel)

    useEffect(() => {
        if (!shouldAutoSelect || isLoading || items.length !== 1) return

        const singleItem = items[0]
        const canAutoSelect = canSelect(singleItem) && !isDisabledFn(singleItem)
        const canAutoNavigate = canNavigateDown(singleItem) && !isDisabledFn(singleItem)

        if (!canAutoSelect && !canAutoNavigate) return

        setIsAutoSelecting(true)

        if (canAutoSelect) {
            select(singleItem)
        } else if (canAutoNavigate) {
            navigateDown(singleItem)
        }

        setIsAutoSelecting(false)
    }, [
        shouldAutoSelect,
        isLoading,
        items,
        canSelect,
        isDisabledFn,
        select,
        canNavigateDown,
        navigateDown,
    ])

    // ========================================================================
    // LIST COUNTS
    // ========================================================================

    const counts = useMemo<EntityListCounts>(() => {
        return computeListCounts({
            loadedCount: items.length,
            totalCount: pagination.totalCount,
            hasMore: pagination.hasNextPage,
            totalCountMode: "unknown",
        })
    }, [items.length, pagination.totalCount, pagination.hasNextPage])

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
        currentLevelLabel,
        searchTerm,
        setSearchTerm,
        navigateDown,
        navigateUp,
        navigateToLevel,
        select,
        reset,
        canNavigateDown,
        canSelect,
        isDisabled: isDisabledFn,

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
        counts,

        // Core
        adapter,
        instanceId,
    }
}
