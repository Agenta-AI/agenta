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

import {bgColors, cn, flexLayouts, gapClasses, justifyClasses, textColors} from "../../utils/styles"

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
     * Whether the item is currently hovered/active (e.g., popover is open)
     */
    isHovered?: boolean

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
    isHovered = false,
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

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            handleClick()
        }
    }

    // Build class names for different states based on design tokens
    // Default: no bg, textColors.secondary (colorTextSecondary)
    // Hover: bgColors.subtle, textColors.primary (colorText)
    // Selected: bgColors.subtle, textColors.primary, border-r-2 border-primary
    const baseClasses = cn(
        flexLayouts.rowCenter,
        justifyClasses.between,
        "px-2 py-2 transition-colors",
        textColors.secondary,
    )
    const stateClasses = isDisabled
        ? "opacity-50 cursor-not-allowed"
        : isSelected
          ? cn(
                bgColors.subtle,
                "cursor-pointer",
                bgColors.hoverState,
                textColors.primary,
                "border-r-2 border-primary",
            )
          : isHovered
            ? cn(bgColors.subtle, "cursor-pointer", textColors.primary)
            : cn("cursor-pointer", bgColors.hoverSubtle, textColors.iconHover)

    return (
        <div
            className={cn(baseClasses, stateClasses, className)}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            role="option"
            tabIndex={isDisabled ? -1 : 0}
            aria-disabled={isDisabled}
            aria-selected={isSelected}
        >
            <div className={cn(flexLayouts.rowCenter, gapClasses.md, "flex-1 min-w-0")}>
                {icon && <span className={cn("flex-shrink-0", textColors.tertiary)}>{icon}</span>}
                <div className="flex-1 min-w-0">
                    <div className="truncate" title={label}>
                        {labelNode ?? label}
                    </div>
                    {description && (
                        <div className={cn(textColors.tertiary, "truncate")}>{description}</div>
                    )}
                </div>
            </div>

            {/* Show chevron for items with children (indicates popover/drill-down available) */}
            {hasChildren && (
                <div className="flex-shrink-0 ml-2">
                    <ChevronRight className={cn("w-3 h-3", textColors.quaternary)} />
                </div>
            )}
        </div>
    )
}

// Also export as EntityListItem for backward compatibility
export {ListItem as EntityListItem}
export type {ListItemProps as EntityListItemProps}
