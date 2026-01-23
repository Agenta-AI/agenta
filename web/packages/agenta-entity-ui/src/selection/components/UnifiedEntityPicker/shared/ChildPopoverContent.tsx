/**
 * ChildPopoverContent Component
 *
 * Renders children in a popover with search and selection highlighting.
 * Used by ListPopoverVariant to show child entities for selection.
 */

import React, {useMemo, useState} from "react"

import {EntityListItem, SearchInput} from "@agenta/ui"
import {Empty, Spin, Tooltip} from "antd"

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
// HELPER: Filter items by search term
// ============================================================================

function filterItems<T>(items: T[], searchTerm: string, getLabel: (item: T) => string): T[] {
    if (!searchTerm.trim()) return items
    const term = searchTerm.toLowerCase().trim()
    return items.filter((item) => getLabel(item).toLowerCase().includes(term))
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
    parentLabel,
    childLevelConfig,
    selectedChildId,
    disabledChildIds,
    disabledChildTooltip = "Already connected",
    onSelect,
}: ChildPopoverContentProps) {
    const [searchTerm, setSearchTerm] = useState("")

    // Fetch children using the hook
    const {items: children, query} = useChildrenData(childLevelConfig, parentId, true)

    // Filter children by search
    const filteredChildren = useMemo(() => {
        return filterItems(children, searchTerm, (item) => childLevelConfig.getLabel(item))
    }, [children, searchTerm, childLevelConfig])

    // Loading state
    if (query.isPending) {
        return (
            <div className="flex items-center justify-center py-4 px-6 min-w-[200px]">
                <Spin size="small" />
                <span className="ml-2 text-zinc-600">Loading...</span>
            </div>
        )
    }

    // Empty state
    if (filteredChildren.length === 0) {
        return (
            <div className="py-4 px-6 min-w-[200px]">
                <Empty
                    description={searchTerm ? "No matches" : "No items"}
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
            </div>
        )
    }

    return (
        <div className="min-w-[220px] max-w-[320px]">
            {/* Search input (show if >5 items) */}
            {children.length > 5 && (
                <div className="p-2 border-b border-zinc-200 dark:border-zinc-700">
                    <SearchInput
                        value={searchTerm}
                        onChange={setSearchTerm}
                        placeholder={`Search ${childLevelConfig.type}s...`}
                        autoFocus={false}
                    />
                </div>
            )}

            {/* Children list */}
            <div className="max-h-[300px] overflow-y-auto py-1 px-1">
                {filteredChildren.map((child) => {
                    const childId = childLevelConfig.getId(child)
                    const label = childLevelConfig.getLabel(child)
                    const labelNode = childLevelConfig.getLabelNode?.(child)
                    const isSelected = childId === selectedChildId
                    const isDisabled = disabledChildIds?.has(childId) ?? false

                    // Disabled children: show tooltip, grayed out, not clickable
                    if (isDisabled) {
                        return (
                            <Tooltip key={childId} title={disabledChildTooltip}>
                                <div className="opacity-50 cursor-not-allowed">
                                    <EntityListItem
                                        label={label}
                                        labelNode={labelNode}
                                        isSelectable={false}
                                        isSelected={false}
                                    />
                                </div>
                            </Tooltip>
                        )
                    }

                    return (
                        <EntityListItem
                            key={childId}
                            label={label}
                            labelNode={labelNode}
                            isSelectable
                            isSelected={isSelected}
                            onClick={() => onSelect(child)}
                            onSelect={() => onSelect(child)}
                        />
                    )
                })}
            </div>
        </div>
    )
}
