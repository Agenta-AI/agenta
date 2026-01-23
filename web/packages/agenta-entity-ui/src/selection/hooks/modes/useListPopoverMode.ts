/**
 * useListPopoverMode Hook
 *
 * List-popover selection mode for 2-level hierarchies.
 * Shows a vertical list of parent entities with hover/click popovers
 * for child entity selection.
 *
 * Pattern: Vertical list of parents → Hover/click to show popover with children
 *
 * Used by EntityListWithPopover (TestsetPicker style).
 */

import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import type {
    EntitySelectionAdapter,
    EntitySelectionResult,
    HierarchyLevel,
    SelectionPathItem,
} from "../../types"
import {
    useEntitySelectionCore,
    getLevelLabel,
    type EntitySelectionCoreOptions,
} from "../useEntitySelectionCore"
import {useLevelData, filterItems, buildPathItem, type LevelQueryState} from "../utilities"

// ============================================================================
// TYPES
// ============================================================================

/**
 * State for a parent item in the list
 */
export interface ListPopoverParentState<T = unknown> {
    /** Parent entity data */
    entity: T
    /** Parent ID */
    id: string
    /** Display label */
    label: string
    /** Rich label node (if available) */
    labelNode?: React.ReactNode
    /** Whether this parent is currently selected */
    isSelected: boolean
    /** Whether this parent is disabled */
    isDisabled: boolean
    /** Whether the popover for this parent is open */
    isPopoverOpen: boolean
}

/**
 * State for child items in the popover
 */
export interface ListPopoverChildrenState<T = unknown> {
    /** Child items */
    items: T[]
    /** Query state */
    query: LevelQueryState
    /** Parent ID these children belong to */
    parentId: string
    /** Parent label */
    parentLabel: string
}

/**
 * Options for useListPopoverMode
 */
export interface UseListPopoverModeOptions<TSelection = EntitySelectionResult> extends Omit<
    EntitySelectionCoreOptions<TSelection>,
    "autoSelectByLevel"
> {
    /**
     * Currently selected parent ID (for highlighting)
     */
    selectedParentId?: string | null

    /**
     * Currently selected child ID (for highlighting)
     */
    selectedChildId?: string | null

    /**
     * Auto-select first parent on mount if none selected
     * @default false
     */
    autoSelectFirst?: boolean

    /**
     * Auto-select the latest (first) child of the first parent on mount.
     * Triggers onSelect with the first parent's first child.
     * @default false
     */
    autoSelectLatest?: boolean

    /**
     * When true, clicking a parent will automatically select its latest (first) child.
     * @default false
     */
    selectLatestOnParentClick?: boolean

    /**
     * Set of parent IDs that should be disabled (grayed out, not selectable)
     */
    disabledParentIds?: Set<string>

    /**
     * Set of child IDs that should be disabled (grayed out, not selectable)
     */
    disabledChildIds?: Set<string>
}

/**
 * Result from useListPopoverMode
 */
export interface UseListPopoverModeResult<TSelection = EntitySelectionResult> {
    // Parent list state
    /** Filtered parent items */
    parents: ListPopoverParentState[]
    /** Parent level configuration */
    parentLevelConfig: HierarchyLevel<unknown>
    /** Parent level label (e.g., "Testset") */
    parentLabel: string
    /** Whether parents are loading */
    isLoadingParents: boolean
    /** Parent query error */
    parentsError: Error | null

    // Child (popover) state
    /** Child level configuration */
    childLevelConfig: HierarchyLevel<unknown>
    /** Child level label (e.g., "Revision") */
    childLabel: string
    /** Get children state for a parent (call in popover content) */
    getChildrenState: (parentId: string, parentLabel: string) => ListPopoverChildrenState

    // Search
    /** Search term for filtering parents */
    searchTerm: string
    /** Set search term */
    setSearchTerm: (term: string) => void

    // Popover control
    /** Currently open popover's parent ID (null if none) */
    openPopoverId: string | null
    /** Set which popover is open */
    setOpenPopoverId: (id: string | null) => void

    // Actions
    /** Handle parent hover (for preloading) */
    handleParentHover: (parentId: string) => void
    /** Handle parent click */
    handleParentClick: (parent: unknown) => void
    /** Handle child selection from popover */
    handleChildSelect: (parentId: string, parentLabel: string, child: unknown) => void
    /** Check if a child is disabled */
    isChildDisabled: (childId: string) => boolean
    /** Check if a child is selected */
    isChildSelected: (childId: string) => boolean

    // Auto-select state
    /** Parent being auto-selected (for latest selection) */
    autoSelectingParent: {id: string; label: string} | null

    // Core
    /** Resolved adapter */
    adapter: EntitySelectionAdapter<TSelection>
    /** Instance ID */
    instanceId: string
}

// ============================================================================
// INTERNAL: useChildrenData Hook
// ============================================================================

/**
 * Hook to get children data for a specific parent.
 * Designed to be called within popover content.
 */
export function useChildrenData(
    childLevelConfig: HierarchyLevel<unknown>,
    parentId: string,
    isEnabled = true,
): {items: unknown[]; query: LevelQueryState} {
    // Call onBeforeLoad to enable the query
    useEffect(() => {
        if (isEnabled && parentId) {
            childLevelConfig.onBeforeLoad?.(parentId)
        }
    }, [childLevelConfig, parentId, isEnabled])

    return useLevelData({
        levelConfig: childLevelConfig,
        parentId,
        isEnabled,
    })
}

// ============================================================================
// HOOK: useListPopoverMode
// ============================================================================

/**
 * Hook for list-popover entity selection mode.
 *
 * Displays a vertical list of parent entities with popovers
 * for selecting child entities.
 *
 * Designed specifically for 2-level hierarchies like Testset → Revision.
 *
 * @example
 * ```typescript
 * const {
 *     parents,
 *     parentLevelConfig,
 *     childLevelConfig,
 *     handleChildSelect,
 *     openPopoverId,
 *     setOpenPopoverId,
 * } = useListPopoverMode({
 *     adapter: "testset",
 *     onSelect: handleSelect,
 *     selectedParentId,
 *     selectedChildId,
 *     autoSelectLatest: true,
 * })
 *
 * // Render parent list with popovers
 * {parents.map((parent) => (
 *     <Popover
 *         key={parent.id}
 *         open={parent.isPopoverOpen}
 *         onOpenChange={(open) => setOpenPopoverId(open ? parent.id : null)}
 *         content={
 *             <ChildList
 *                 parentId={parent.id}
 *                 parentLabel={parent.label}
 *                 childLevelConfig={childLevelConfig}
 *                 onSelect={(child) => handleChildSelect(parent.id, parent.label, child)}
 *             />
 *         }
 *     >
 *         <ListItem
 *             label={parent.label}
 *             isSelected={parent.isSelected}
 *             isDisabled={parent.isDisabled}
 *         />
 *     </Popover>
 * ))}
 * ```
 */
export function useListPopoverMode<TSelection = EntitySelectionResult>(
    options: UseListPopoverModeOptions<TSelection>,
): UseListPopoverModeResult<TSelection> {
    const {
        onSelect,
        selectedParentId,
        selectedChildId,
        autoSelectFirst = false,
        autoSelectLatest = false,
        selectLatestOnParentClick = false,
        disabledParentIds,
        disabledChildIds,
    } = options

    // Get core utilities
    const {adapter, hierarchyLevels, instanceId, createSelection} = useEntitySelectionCore(options)

    // Validate 2-level hierarchy
    if (hierarchyLevels.length !== 2) {
        console.warn(`useListPopoverMode requires exactly 2 levels, got ${hierarchyLevels.length}`)
    }

    const parentLevelConfig = hierarchyLevels[0]
    const childLevelConfig = hierarchyLevels[1]

    const parentLabel = getLevelLabel(parentLevelConfig)
    const childLabel = getLevelLabel(childLevelConfig)

    // ========================================================================
    // SEARCH STATE
    // ========================================================================

    const [searchTerm, setSearchTerm] = useState("")

    // ========================================================================
    // POPOVER STATE
    // ========================================================================

    const [openPopoverId, setOpenPopoverId] = useState<string | null>(null)

    // ========================================================================
    // AUTO-SELECT STATE
    // ========================================================================

    const hasAutoSelectedRef = useRef(false)
    const hasAutoSelectedLatestRef = useRef(false)
    const [autoSelectingParent, setAutoSelectingParent] = useState<{
        id: string
        label: string
    } | null>(null)

    // ========================================================================
    // PARENT DATA
    // ========================================================================

    const {items: parentItems, query: parentQuery} = useLevelData({
        levelConfig: parentLevelConfig,
        parentId: null,
        isEnabled: true,
    })

    // Filter parents by search
    const filteredParentItems = useMemo(() => {
        return filterItems(parentItems, searchTerm).filter((item) => {
            const label = parentLevelConfig.getLabel(item)
            return label.toLowerCase().includes(searchTerm.toLowerCase())
        })
    }, [parentItems, searchTerm, parentLevelConfig])

    // Build parent states
    const parents = useMemo((): ListPopoverParentState[] => {
        return filteredParentItems.map((entity) => {
            const id = parentLevelConfig.getId(entity)
            const label = parentLevelConfig.getLabel(entity)
            const labelNode = parentLevelConfig.getLabelNode?.(entity)

            return {
                entity,
                id,
                label,
                labelNode,
                isSelected: id === selectedParentId,
                isDisabled: disabledParentIds?.has(id) ?? false,
                isPopoverOpen: id === openPopoverId,
            }
        })
    }, [filteredParentItems, parentLevelConfig, selectedParentId, disabledParentIds, openPopoverId])

    // ========================================================================
    // CHILD DATA HELPERS
    // ========================================================================

    /**
     * Get children state for a parent.
     * This is designed to be called in popover content components.
     */
    const getChildrenState = useCallback(
        (parentId: string, parentLabel: string): ListPopoverChildrenState => {
            // This returns a placeholder - actual data should be fetched
            // using useChildrenData hook in the popover content component
            return {
                items: [],
                query: {isPending: true, isError: false, error: null},
                parentId,
                parentLabel,
            }
        },
        [],
    )

    const isChildDisabled = useCallback(
        (childId: string): boolean => {
            return disabledChildIds?.has(childId) ?? false
        },
        [disabledChildIds],
    )

    const isChildSelected = useCallback(
        (childId: string): boolean => {
            return childId === selectedChildId
        },
        [selectedChildId],
    )

    // ========================================================================
    // ACTIONS
    // ========================================================================

    const handleParentHover = useCallback(
        (parentId: string) => {
            // Trigger onBeforeLoad for preloading children
            childLevelConfig.onBeforeLoad?.(parentId)
        },
        [childLevelConfig],
    )

    const handleParentClick = useCallback(
        (parent: unknown) => {
            const parentId = parentLevelConfig.getId(parent)
            const parentLabelStr = parentLevelConfig.getLabel(parent)

            if (disabledParentIds?.has(parentId)) {
                return
            }

            if (selectLatestOnParentClick) {
                // Trigger auto-select of latest child
                setAutoSelectingParent({id: parentId, label: parentLabelStr})
            }
        },
        [parentLevelConfig, disabledParentIds, selectLatestOnParentClick],
    )

    const handleChildSelect = useCallback(
        (parentId: string, parentLabelStr: string, child: unknown) => {
            if (!onSelect) return

            const parentPathItem: SelectionPathItem = {
                type: parentLevelConfig.type,
                id: parentId,
                label: parentLabelStr,
            }

            const childPathItem = buildPathItem(child, childLevelConfig)
            const fullPath = [parentPathItem, childPathItem]
            const selection = createSelection(fullPath, child)

            onSelect(selection)
            setOpenPopoverId(null)
        },
        [parentLevelConfig, childLevelConfig, createSelection, onSelect],
    )

    // ========================================================================
    // AUTO-SELECT FIRST
    // ========================================================================

    useEffect(() => {
        if (
            !autoSelectFirst ||
            hasAutoSelectedRef.current ||
            parentQuery.isPending ||
            filteredParentItems.length === 0 ||
            selectedParentId
        ) {
            return
        }

        hasAutoSelectedRef.current = true
        // Note: This just marks auto-select as done
        // Actual selection depends on whether autoSelectLatest is also enabled
    }, [autoSelectFirst, parentQuery.isPending, filteredParentItems, selectedParentId])

    // ========================================================================
    // AUTO-SELECT LATEST
    // ========================================================================

    useEffect(() => {
        if (
            !autoSelectLatest ||
            hasAutoSelectedLatestRef.current ||
            parentQuery.isPending ||
            filteredParentItems.length === 0
        ) {
            return
        }

        hasAutoSelectedLatestRef.current = true
        const firstParent = filteredParentItems[0]
        const parentId = parentLevelConfig.getId(firstParent)
        const parentLabelStr = parentLevelConfig.getLabel(firstParent)

        // Trigger auto-selection of this parent's first child
        setAutoSelectingParent({id: parentId, label: parentLabelStr})
    }, [autoSelectLatest, parentQuery.isPending, filteredParentItems, parentLevelConfig])

    // ========================================================================
    // RETURN
    // ========================================================================

    return {
        // Parent list
        parents,
        parentLevelConfig,
        parentLabel,
        isLoadingParents: parentQuery.isPending,
        parentsError: parentQuery.error,

        // Child (popover)
        childLevelConfig,
        childLabel,
        getChildrenState,

        // Search
        searchTerm,
        setSearchTerm,

        // Popover control
        openPopoverId,
        setOpenPopoverId,

        // Actions
        handleParentHover,
        handleParentClick,
        handleChildSelect,
        isChildDisabled,
        isChildSelected,

        // Auto-select
        autoSelectingParent,

        // Core
        adapter,
        instanceId,
    }
}

// ============================================================================
// EXPORT: useAutoSelectLatestChild
// ============================================================================

/**
 * Hook for auto-selecting the latest (first) child of a parent.
 *
 * Use this in a component that renders when autoSelectingParent is set.
 * It will fetch the children and call onSelect with the first child.
 *
 * @example
 * ```typescript
 * if (autoSelectingParent) {
 *     return (
 *         <AutoSelectLatestChild
 *             parentId={autoSelectingParent.id}
 *             parentLabel={autoSelectingParent.label}
 *             childLevelConfig={childLevelConfig}
 *             adapter={adapter}
 *             onSelect={onSelect}
 *             onComplete={() => setAutoSelectingParent(null)}
 *         />
 *     )
 * }
 * ```
 */
export interface UseAutoSelectLatestChildOptions<TSelection = EntitySelectionResult> {
    parentId: string
    parentLabel: string
    parentLevelConfig: HierarchyLevel<unknown>
    childLevelConfig: HierarchyLevel<unknown>
    createSelection: (path: SelectionPathItem[], entity: unknown) => TSelection
    onSelect?: (selection: TSelection) => void
    onComplete: () => void
}

export function useAutoSelectLatestChild<TSelection = EntitySelectionResult>({
    parentId,
    parentLabel,
    parentLevelConfig,
    childLevelConfig,
    createSelection,
    onSelect,
    onComplete,
}: UseAutoSelectLatestChildOptions<TSelection>): void {
    const hasSelectedRef = useRef(false)

    // Fetch children
    const {items: children, query} = useChildrenData(childLevelConfig, parentId, true)

    // Auto-select first child when loaded
    useEffect(() => {
        if (hasSelectedRef.current || query.isPending || children.length === 0) {
            return
        }

        hasSelectedRef.current = true
        const firstChild = children[0]

        const parentPathItem: SelectionPathItem = {
            type: parentLevelConfig.type,
            id: parentId,
            label: parentLabel,
        }

        const childPathItem = buildPathItem(firstChild, childLevelConfig)
        const fullPath = [parentPathItem, childPathItem]
        const selection = createSelection(fullPath, firstChild)

        onSelect?.(selection)
        onComplete()
    }, [
        query.isPending,
        children,
        parentId,
        parentLabel,
        parentLevelConfig,
        childLevelConfig,
        createSelection,
        onSelect,
        onComplete,
    ])
}
