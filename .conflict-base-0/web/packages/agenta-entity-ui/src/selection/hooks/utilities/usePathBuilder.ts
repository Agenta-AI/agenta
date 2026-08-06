/**
 * usePathBuilder Utility
 *
 * Unified path building and selection result creation.
 * Handles building SelectionPathItem arrays and converting to final selections.
 *
 * Used by both cascading and hierarchical selection modes.
 */

import {useCallback, useMemo, useRef, useEffect} from "react"

import type {
    EntitySelectionAdapter,
    EntitySelectionResult,
    HierarchyLevel,
    SelectionPathItem,
} from "../../types"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Level state used for path building
 */
export interface LevelState<T = unknown> {
    /** Level index */
    index: number
    /** Effective ID (user selection or auto-selected) */
    effectiveId: string | null
    /** Selected entity data */
    selectedEntity: T | null
    /** Level configuration */
    config: HierarchyLevel<T>
}

/**
 * Options for path builder hook
 */
export interface UsePathBuilderOptions<TSelection = EntitySelectionResult> {
    /** Resolved adapter */
    adapter: EntitySelectionAdapter<TSelection>
    /** Current level states */
    levels: LevelState[]
    /** Callback when selection is complete */
    onSelect?: (selection: TSelection) => void
}

/**
 * Result from path builder hook
 */
export interface UsePathBuilderResult<TSelection = EntitySelectionResult> {
    /** Current selection path */
    path: SelectionPathItem[]
    /** Complete selection (null if not all levels selected) */
    selection: TSelection | null
    /** Whether selection is complete */
    isComplete: boolean
}

// ============================================================================
// HOOK: usePathBuilder
// ============================================================================

/**
 * Hook that builds selection paths and triggers onSelect.
 *
 * Handles:
 * - Building path from level states
 * - Creating selection result via adapter
 * - Triggering onSelect callback (only when selection changes)
 *
 * @example
 * ```typescript
 * const { path, selection, isComplete } = usePathBuilder({
 *     adapter,
 *     levels: [level0, level1, level2],
 *     onSelect: handleSelect,
 * })
 * ```
 */
export function usePathBuilder<TSelection = EntitySelectionResult>({
    adapter,
    levels,
    onSelect,
}: UsePathBuilderOptions<TSelection>): UsePathBuilderResult<TSelection> {
    // Build path and selection
    const {path, selection} = useMemo(() => {
        const selectableLevel =
            adapter.hierarchy.selectableLevel ?? adapter.hierarchy.levels.length - 1

        // Build path from all levels with selections
        const pathItems: SelectionPathItem[] = []

        for (let i = 0; i <= selectableLevel && i < levels.length; i++) {
            const level = levels[i]
            if (level.effectiveId && level.selectedEntity) {
                pathItems.push({
                    type: level.config.type,
                    id: level.effectiveId,
                    label: level.config.getLabel(level.selectedEntity),
                })
            }
        }

        // Check if all required levels have selections
        const allLevelsSelected = pathItems.length > selectableLevel

        if (!allLevelsSelected) {
            return {path: pathItems, selection: null}
        }

        // Get leaf entity for selection creation
        const leafLevel = levels[selectableLevel]
        if (!leafLevel?.selectedEntity) {
            return {path: pathItems, selection: null}
        }

        // Create selection via adapter
        const selectionResult = adapter.toSelection(pathItems, leafLevel.selectedEntity)

        return {
            path: pathItems,
            selection: selectionResult,
        }
    }, [adapter, levels])

    const isComplete = selection !== null

    // Track previous selection to avoid duplicate onSelect calls
    const prevSelectionIdRef = useRef<string | null>(null)

    useEffect(() => {
        if (!selection || !onSelect) return

        // Cast to EntitySelectionResult to access id property
        const currentId = (selection as unknown as EntitySelectionResult).id
        if (currentId !== prevSelectionIdRef.current) {
            prevSelectionIdRef.current = currentId
            onSelect(selection)
        }
    }, [selection, onSelect])

    return {
        path,
        selection,
        isComplete,
    }
}

// ============================================================================
// UTILITY: buildPath
// ============================================================================

/**
 * Build a selection path from level states (pure function).
 *
 * @example
 * ```typescript
 * const path = buildPath(levels, selectableLevel)
 * ```
 */
export function buildPath(levels: LevelState[], selectableLevel?: number): SelectionPathItem[] {
    const maxLevel = selectableLevel ?? levels.length - 1
    const path: SelectionPathItem[] = []

    for (let i = 0; i <= maxLevel && i < levels.length; i++) {
        const level = levels[i]
        if (level.effectiveId && level.selectedEntity) {
            path.push({
                type: level.config.type,
                id: level.effectiveId,
                label: level.config.getLabel(level.selectedEntity),
            })
        }
    }

    return path
}

// ============================================================================
// UTILITY: buildPathItem
// ============================================================================

/**
 * Build a single path item from an entity.
 *
 * @example
 * ```typescript
 * const pathItem = buildPathItem(entity, levelConfig)
 * ```
 */
export function buildPathItem<T>(entity: T, levelConfig: HierarchyLevel<T>): SelectionPathItem {
    return {
        type: levelConfig.type,
        id: levelConfig.getId(entity),
        label: levelConfig.getLabel(entity),
    }
}

// ============================================================================
// UTILITY: isPathComplete
// ============================================================================

/**
 * Check if a selection path is complete.
 *
 * @example
 * ```typescript
 * if (isPathComplete(path, adapter)) {
 *     // Selection is ready
 * }
 * ```
 */
export function isPathComplete<TSelection = EntitySelectionResult>(
    path: SelectionPathItem[],
    adapter: EntitySelectionAdapter<TSelection>,
): boolean {
    return adapter.isComplete(path)
}

// ============================================================================
// HOOK: useSelectionCallback
// ============================================================================

/**
 * Creates a stable callback for triggering selection.
 *
 * Useful in hierarchical mode where selection happens on user action.
 *
 * @example
 * ```typescript
 * const select = useSelectionCallback({
 *     adapter,
 *     currentPath,
 *     onSelect,
 * })
 *
 * // Call when user clicks an item
 * select(entity, levelConfig)
 * ```
 */
export interface UseSelectionCallbackOptions<TSelection = EntitySelectionResult> {
    /** Resolved adapter */
    adapter: EntitySelectionAdapter<TSelection>
    /** Current path (breadcrumb) */
    currentPath: SelectionPathItem[]
    /** Callback when selection is complete */
    onSelect?: (selection: TSelection) => void
}

export function useSelectionCallback<TSelection = EntitySelectionResult, T = unknown>({
    adapter,
    currentPath,
    onSelect,
}: UseSelectionCallbackOptions<TSelection>): (entity: T, levelConfig: HierarchyLevel<T>) => void {
    return useCallback(
        (entity: T, levelConfig: HierarchyLevel<T>) => {
            const pathItem = buildPathItem(entity, levelConfig)
            const fullPath = [...currentPath, pathItem]
            const selection = adapter.toSelection(fullPath, entity)
            onSelect?.(selection)
        },
        [adapter, currentPath, onSelect],
    )
}

// ============================================================================
// UTILITY: findEntityInItems
// ============================================================================

/**
 * Find an entity in a list by ID.
 *
 * @example
 * ```typescript
 * const entity = findEntityInItems(items, selectedId, levelConfig)
 * ```
 */
export function findEntityInItems<T>(
    items: T[],
    id: string | null,
    levelConfig: HierarchyLevel<T>,
): T | null {
    if (!id) return null
    return items.find((item) => levelConfig.getId(item) === id) ?? null
}

// ============================================================================
// UTILITY: getPathIds
// ============================================================================

/**
 * Extract IDs from a selection path.
 *
 * @example
 * ```typescript
 * const [appId, variantId, revisionId] = getPathIds(path)
 * ```
 */
export function getPathIds(path: SelectionPathItem[]): string[] {
    return path.map((item) => item.id)
}

/**
 * Get ID at a specific level in the path.
 */
export function getPathIdAtLevel(path: SelectionPathItem[], level: number): string | null {
    return path[level]?.id ?? null
}

// ============================================================================
// HOOK: usePathMemo
// ============================================================================

/**
 * Memoizes a path array to prevent unnecessary re-renders.
 *
 * Uses shallow comparison of path items.
 *
 * @example
 * ```typescript
 * const stablePath = usePathMemo(path)
 * ```
 */
export function usePathMemo(path: SelectionPathItem[]): SelectionPathItem[] {
    const prevPathRef = useRef<SelectionPathItem[]>(path)

    // Check if path changed (shallow comparison)
    const pathChanged =
        path.length !== prevPathRef.current.length ||
        path.some(
            (item, i) =>
                item.id !== prevPathRef.current[i]?.id ||
                item.type !== prevPathRef.current[i]?.type,
        )

    if (pathChanged) {
        prevPathRef.current = path
    }

    return prevPathRef.current
}
