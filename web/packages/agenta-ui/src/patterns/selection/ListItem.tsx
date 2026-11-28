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

import {CaretRightIcon} from "@phosphor-icons/react"

import {cn} from "../../foundation/utils/cn"

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
     * Node rendered before the icon/label (e.g., a selection checkbox).
     * Click handling inside this node must stopPropagation itself so the
     * row click (navigation/selection) is not triggered.
     */
    prefixNode?: React.ReactNode

    /**
     * Node rendered below the label/description block (e.g., selected-revision chips).
     */
    footerNode?: React.ReactNode

    /**
     * Node rendered after the label block, before the chevron (e.g., a type tag).
     * Vertically centered against the whole row, independent of the label lines.
     */
    suffixNode?: React.ReactNode

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
    prefixNode,
    footerNode,
    suffixNode,
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

    // Hover is the translucent `accent`, so it shows on any surface; selection is `selected`.
    const baseClasses =
        "flex items-center justify-between box-border px-2 py-2 transition-colors rounded-md text-muted-foreground"
    const stateClasses = isDisabled
        ? "opacity-50 cursor-not-allowed"
        : isSelected
          ? "cursor-pointer bg-selected hover:bg-[image:linear-gradient(var(--accent),var(--accent))] text-foreground"
          : isHovered
            ? "cursor-pointer bg-selected text-foreground"
            : "cursor-pointer hover:bg-accent hover:text-foreground"

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
            <div className="flex items-center gap-3 flex-1 min-w-0">
                {prefixNode && (
                    <span className="flex-shrink-0 flex items-center">{prefixNode}</span>
                )}
                {icon && <span className="flex-shrink-0 text-muted-foreground">{icon}</span>}
                <div className="flex-1 min-w-0">
                    <div className="truncate text-field-md" title={label}>
                        {labelNode ?? label}
                    </div>
                    {description && (
                        <div className="text-muted-foreground truncate text-field-md">
                            {description}
                        </div>
                    )}
                    {footerNode}
                </div>
            </div>

            {suffixNode && (
                <span className="flex-shrink-0 flex items-center ml-2">{suffixNode}</span>
            )}

            {/* Show chevron for items with children (indicates popover/drill-down available) */}
            {hasChildren && (
                <div className="flex-shrink-0 ml-2">
                    <CaretRightIcon className="w-3 h-3 text-muted-foreground" />
                </div>
            )}
        </div>
    )
}

// Also export as EntityListItem for backward compatibility
export {ListItem as EntityListItem}
export type {ListItemProps as EntityListItemProps}
