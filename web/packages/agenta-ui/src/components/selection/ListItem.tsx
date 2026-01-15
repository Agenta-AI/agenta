/**
 * ListItem Component
 *
 * A list item for selection with support for:
 * - Navigation (drill-down) into children
 * - Selection of leaf items
 * - Disabled state
 * - Description text
 *
 * @example
 * ```tsx
 * import {ListItem} from '@agenta/ui'
 *
 * <ListItem
 *   label="My App"
 *   description="Production version"
 *   hasChildren
 *   onClick={() => navigateDown(item)}
 * />
 * ```
 */

import React from "react"

import {ChevronRight} from "lucide-react"

// ============================================================================
// TYPES
// ============================================================================

export interface ListItemProps {
    /**
     * Item label (text version, used for accessibility/title)
     */
    label: string

    /**
     * Rich label node (optional, for enhanced display with badges/icons)
     * Falls back to label if not provided
     */
    labelNode?: React.ReactNode

    /**
     * Optional description
     */
    description?: string

    /**
     * Optional icon
     */
    icon?: React.ReactNode

    /**
     * Whether the item can be navigated into
     */
    hasChildren?: boolean

    /**
     * Whether the item can be selected
     */
    isSelectable?: boolean

    /**
     * Whether the item is currently selected
     */
    isSelected?: boolean

    /**
     * Whether the item is disabled
     */
    isDisabled?: boolean

    /**
     * Callback when clicked (for navigation)
     */
    onClick?: () => void

    /**
     * Callback when selected
     */
    onSelect?: () => void

    /**
     * Additional CSS class
     */
    className?: string
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * A single list item for selection
 */
export function ListItem({
    label,
    labelNode,
    description,
    icon,
    hasChildren = false,
    isSelectable = false,
    isSelected = false,
    isDisabled = false,
    onClick,
    onSelect,
    className = "",
}: ListItemProps) {
    const handleClick = () => {
        if (isDisabled) return

        if (isSelectable && onSelect) {
            onSelect()
        } else if (hasChildren && onClick) {
            onClick()
        }
    }

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            handleClick()
        }
    }

    // Build class names for different states
    const baseClasses = "flex items-center justify-between p-3 rounded-md transition-colors"
    const stateClasses = isDisabled
        ? "opacity-50 cursor-not-allowed"
        : isSelected
          ? "bg-blue-50 cursor-pointer hover:bg-blue-100" // Selected: light blue bg, darker on hover
          : "cursor-pointer hover:bg-gray-50" // Default: gray hover

    return (
        <div
            className={`${baseClasses} ${stateClasses} ${className}`}
            onClick={handleClick}
            onKeyPress={handleKeyPress}
            role="button"
            tabIndex={isDisabled ? -1 : 0}
            aria-disabled={isDisabled}
            aria-selected={isSelected}
        >
            <div className="flex items-center gap-3 flex-1 min-w-0">
                {icon && <span className="flex-shrink-0 text-gray-500">{icon}</span>}
                <div className="flex-1 min-w-0">
                    <div className="truncate" title={label}>
                        {labelNode ?? label}
                    </div>
                    {description && <div className="text-gray-500 truncate">{description}</div>}
                </div>
            </div>

            {/* Only show chevron for navigable items, no checkmark for selected */}
            {hasChildren && !isSelectable && (
                <div className="flex-shrink-0 ml-2">
                    <ChevronRight className="w-3 h-3 text-gray-400" />
                </div>
            )}
        </div>
    )
}

// Also export as EntityListItem for backward compatibility
export {ListItem as EntityListItem}
export type {ListItemProps as EntityListItemProps}
