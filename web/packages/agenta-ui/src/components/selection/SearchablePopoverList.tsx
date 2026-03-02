/**
 * SearchablePopoverList Component
 *
 * A compact list for popover content with search, selection highlighting,
 * and support for disabled items. Designed for use in Popover/Dropdown components.
 *
 * @example
 * ```tsx
 * import { SearchablePopoverList } from '@agenta/ui'
 *
 * <Popover
 *   content={
 *     <SearchablePopoverList
 *       items={revisions}
 *       selectedId={selectedRevisionId}
 *       onSelect={handleSelect}
 *       getItemId={(r) => r.id}
 *       getItemLabel={(r) => `v${r.version}`}
 *       isLoading={isLoading}
 *     />
 *   }
 * >
 *   <Button>Select Revision</Button>
 * </Popover>
 * ```
 */

import React, {useMemo, useState} from "react"

import {filterItems} from "@agenta/shared/utils"
import {Empty, Spin, Tooltip} from "antd"

import {EntityListItem} from "./ListItem"
import {SearchInput} from "./SearchInput"

// ============================================================================
// TYPES
// ============================================================================

export interface SearchablePopoverListProps<T> {
    /**
     * Items to display in the list
     */
    items: T[]

    /**
     * Currently selected item ID (for highlighting)
     */
    selectedId?: string | null

    /**
     * Callback when an item is selected
     */
    onSelect: (item: T) => void

    /**
     * Get unique ID from item
     */
    getItemId: (item: T) => string

    /**
     * Get string label from item (used for search filtering and display)
     */
    getItemLabel: (item: T) => string

    /**
     * Get rich label node from item (optional, for display)
     */
    getItemLabelNode?: (item: T) => React.ReactNode

    /**
     * Set of disabled item IDs
     */
    disabledIds?: Set<string>

    /**
     * Tooltip text for disabled items
     * @default "Already selected"
     */
    disabledTooltip?: string

    /**
     * Whether the list is loading
     * @default false
     */
    isLoading?: boolean

    /**
     * Search placeholder text
     */
    searchPlaceholder?: string

    /**
     * Minimum items to show search input
     * @default 5
     */
    searchThreshold?: number

    /**
     * Maximum height of the list
     * @default 300
     */
    maxHeight?: number

    /**
     * Minimum width of the container
     * @default 220
     */
    minWidth?: number

    /**
     * Maximum width of the container
     * @default 320
     */
    maxWidth?: number

    /**
     * Loading message
     * @default "Loading..."
     */
    loadingMessage?: string

    /**
     * Empty state message when no matches
     * @default "No matches"
     */
    noMatchesMessage?: string

    /**
     * Empty state message when no items
     * @default "No items"
     */
    emptyMessage?: string

    /**
     * Additional class name for the container
     */
    className?: string
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * SearchablePopoverList
 *
 * Renders a compact list suitable for popovers/dropdowns with:
 * - Search filtering (shown if items > threshold)
 * - Selection highlighting
 * - Disabled state handling with tooltip
 * - Loading state
 * - Empty state
 */
export function SearchablePopoverList<T>({
    items,
    selectedId,
    onSelect,
    getItemId,
    getItemLabel,
    getItemLabelNode,
    disabledIds,
    disabledTooltip = "Already selected",
    isLoading = false,
    searchPlaceholder,
    searchThreshold = 5,
    maxHeight = 300,
    minWidth = 220,
    maxWidth = 320,
    loadingMessage = "Loading...",
    noMatchesMessage = "No matches",
    emptyMessage = "No items",
    className,
}: SearchablePopoverListProps<T>) {
    const [searchTerm, setSearchTerm] = useState("")

    // Filter items by search
    const filteredItems = useMemo(() => {
        return filterItems(items, searchTerm, getItemLabel)
    }, [items, searchTerm, getItemLabel])

    // Default search placeholder
    const effectiveSearchPlaceholder = searchPlaceholder ?? "Search..."

    // Loading state
    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-4 px-6" style={{minWidth}}>
                <Spin size="small" />
                <span className="ml-2 text-zinc-600">{loadingMessage}</span>
            </div>
        )
    }

    // Empty state (after filtering)
    if (filteredItems.length === 0) {
        return (
            <div className="py-4 px-6" style={{minWidth}}>
                <Empty
                    description={searchTerm ? noMatchesMessage : emptyMessage}
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
            </div>
        )
    }

    return (
        <div className={className} style={{minWidth, maxWidth}}>
            {/* Search input (show if items > threshold) */}
            {items.length > searchThreshold && (
                <div className="p-2 border-b border-zinc-200 dark:border-zinc-700">
                    <SearchInput
                        value={searchTerm}
                        onChange={setSearchTerm}
                        placeholder={effectiveSearchPlaceholder}
                        autoFocus={false}
                    />
                </div>
            )}

            {/* Items list */}
            <div className="overflow-y-auto py-1 px-1" style={{maxHeight}}>
                {filteredItems.map((item) => {
                    const itemId = getItemId(item)
                    const label = getItemLabel(item)
                    const labelNode = getItemLabelNode?.(item)
                    const isSelected = itemId === selectedId
                    const isDisabled = disabledIds?.has(itemId) ?? false

                    // Disabled items: show tooltip, grayed out, not clickable
                    if (isDisabled) {
                        return (
                            <Tooltip key={itemId} title={disabledTooltip}>
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
                            key={itemId}
                            label={label}
                            labelNode={labelNode}
                            isSelectable
                            isSelected={isSelected}
                            onClick={() => onSelect(item)}
                            onSelect={() => onSelect(item)}
                        />
                    )
                })}
            </div>
        </div>
    )
}

export default SearchablePopoverList
