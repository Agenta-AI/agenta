/**
 * ChildPopoverContent Component
 *
 * Adapter that fetches children data and renders using SearchablePopoverList.
 * Used by ListPopoverVariant to show child entities for selection.
 *
 * Architecture:
 * - Handles data fetching via useChildrenData hook
 * - Delegates all rendering to SearchablePopoverList from @agenta/ui
 */

import React, {useCallback, useMemo} from "react"

import {SearchablePopoverList} from "@agenta/ui/components/selection"

import {useChildrenData} from "../../../hooks"
import type {HierarchyLevel} from "../../../types"

// ============================================================================
// TYPES
// ============================================================================

export interface ChildPopoverContentProps {
    /**
     * Parent entity ID
     */
    parentId: string

    /**
     * Parent entity label (for display)
     */
    parentLabel: string

    /**
     * Child level configuration
     */
    childLevelConfig: HierarchyLevel<unknown>

    /**
     * Currently selected child ID (for highlighting)
     */
    selectedChildId?: string | null

    /**
     * Set of disabled child IDs
     */
    disabledChildIds?: Set<string>

    /**
     * Tooltip for disabled children
     */
    disabledChildTooltip?: string

    /**
     * Callback when a child is selected
     */
    onSelect: (child: unknown) => void
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Popover content showing child entities for selection.
 *
 * Features:
 * - Search filtering (shown if >5 items)
 * - Selection highlighting
 * - Disabled state handling with tooltip
 * - Loading state
 * - Empty state
 */
export function ChildPopoverContent({
    parentId,
    childLevelConfig,
    selectedChildId,
    disabledChildIds,
    disabledChildTooltip = "Already connected",
    onSelect,
}: ChildPopoverContentProps) {
    // Fetch children using the hook
    const {items: children, query} = useChildrenData(childLevelConfig, parentId, true)

    // Create getter functions that use the config
    const getItemId = useCallback(
        (item: unknown) => childLevelConfig.getId(item),
        [childLevelConfig],
    )

    const getItemLabel = useCallback(
        (item: unknown) => childLevelConfig.getLabel(item),
        [childLevelConfig],
    )

    const getItemLabelNode = useMemo(
        () =>
            childLevelConfig.getLabelNode
                ? (item: unknown) => childLevelConfig.getLabelNode!(item)
                : undefined,
        [childLevelConfig],
    )

    // Build search placeholder
    const searchPlaceholder = `Search ${childLevelConfig.type}s...`

    return (
        <SearchablePopoverList
            items={children}
            selectedId={selectedChildId}
            onSelect={onSelect}
            getItemId={getItemId}
            getItemLabel={getItemLabel}
            getItemLabelNode={getItemLabelNode}
            disabledIds={disabledChildIds}
            disabledTooltip={disabledChildTooltip}
            isLoading={query.isPending}
            searchPlaceholder={searchPlaceholder}
            minWidth={220}
            maxWidth={320}
        />
    )
}
