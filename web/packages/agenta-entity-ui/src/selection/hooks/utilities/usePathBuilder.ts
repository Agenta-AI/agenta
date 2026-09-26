/**
 * usePathBuilder Utility
 *
 * Unified path building and selection result creation.
 * Handles building SelectionPathItem arrays and converting to final selections.
 *
 * Used by both cascading and hierarchical selection modes.
 */

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
