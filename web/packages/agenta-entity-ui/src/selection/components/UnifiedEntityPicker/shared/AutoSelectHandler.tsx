/**
 * AutoSelectHandler Component
 *
 * Invisible component that handles auto-selection of the first child.
 * Used by ListPopoverVariant for autoSelectLatest functionality.
 */

import {useAutoSelectLatestChild} from "../../../hooks"
import type {HierarchyLevel, SelectionPathItem, EntitySelectionResult} from "../../../types"

// ============================================================================
// TYPES
// ============================================================================

export interface AutoSelectHandlerProps<TSelection = EntitySelectionResult> {
    /**
     * Parent entity ID
     */
    parentId: string

    /**
     * Parent entity label
     */
    parentLabel: string

    /**
     * Parent level configuration
     */
    parentLevelConfig: HierarchyLevel<unknown>

    /**
     * Child level configuration
     */
    childLevelConfig: HierarchyLevel<unknown>

    /**
     * Function to create selection result
     */
    createSelection: (path: SelectionPathItem[], entity: unknown) => TSelection

    /**
     * Callback when selection is made
     */
    onSelect?: (selection: TSelection) => void

    /**
     * Callback when auto-selection is complete
     */
    onComplete: () => void
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Invisible component that triggers auto-selection of the first child.
 *
 * Uses useAutoSelectLatestChild hook to:
 * 1. Fetch children for the specified parent
 * 2. Select the first child when loaded
 * 3. Call onComplete when done
 *
 * This component renders nothing - it just performs the selection.
 */
export function AutoSelectHandler<TSelection = EntitySelectionResult>({
    parentId,
    parentLabel,
    parentLevelConfig,
    childLevelConfig,
    createSelection,
    onSelect,
    onComplete,
}: AutoSelectHandlerProps<TSelection>) {
    useAutoSelectLatestChild({
        parentId,
        parentLabel,
        parentLevelConfig,
        childLevelConfig,
        createSelection,
        onSelect,
        onComplete,
    })

    // This component renders nothing - it just triggers the auto-selection
    return null
}
