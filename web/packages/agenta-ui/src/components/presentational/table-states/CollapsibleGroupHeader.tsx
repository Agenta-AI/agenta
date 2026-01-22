/**
 * CollapsibleGroupHeader Component
 *
 * A reusable header component for collapsible table column groups.
 * Displays a caret icon, label, and optional count with consistent styling.
 *
 * @example
 * ```typescript
 * import { CollapsibleGroupHeader } from '@agenta/ui'
 *
 * // Basic usage
 * <CollapsibleGroupHeader
 *   label="inputs"
 *   isCollapsed={false}
 *   count={3}
 *   onClick={() => toggleCollapse('inputs')}
 * />
 *
 * // With custom label renderer (e.g., editable header)
 * <CollapsibleGroupHeader
 *   label="inputs"
 *   isCollapsed={false}
 *   count={3}
 *   onClick={() => toggleCollapse('inputs')}
 *   renderLabel={(label) => (
 *     <EditableColumnHeader columnKey={label} columnName={label} ... />
 *   )}
 * />
 * ```
 */

import type {ReactNode} from "react"

import {CaretDown, CaretRight} from "@phosphor-icons/react"

import {
    cn,
    flexLayouts,
    focusStyles,
    gapClasses,
    textColors,
    textSizes,
} from "../../../utils/styles"

/** Default icon size for caret icons */
const DEFAULT_ICON_SIZE = 14

export interface CollapsibleGroupHeaderProps {
    /** Group label to display */
    label: string
    /** Whether the group is currently collapsed */
    isCollapsed: boolean
    /** Optional count or label to display (e.g., number of columns or "collapsed") */
    count?: number | string
    /** Click handler for toggling collapse state. Accepts both mouse and keyboard events for accessibility. */
    onClick?: (e: React.MouseEvent | React.KeyboardEvent) => void
    /** Additional CSS class names */
    className?: string
    /**
     * Custom label renderer. When provided, replaces the default label span.
     * Useful for editable headers or custom styling.
     */
    renderLabel?: (label: string) => ReactNode
    /**
     * Size of the caret icon in pixels
     * @default 14
     */
    iconSize?: number
}

export function CollapsibleGroupHeader({
    label,
    isCollapsed,
    count,
    onClick,
    className,
    renderLabel,
    iconSize = DEFAULT_ICON_SIZE,
}: CollapsibleGroupHeaderProps) {
    const handleCaretClick = (e: React.MouseEvent) => {
        e.stopPropagation()
        onClick?.(e)
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onClick?.(e)
        }
    }

    // When using custom label renderer, only the caret should trigger collapse
    // The label area is controlled by the custom renderer
    const hasCustomLabel = !!renderLabel

    // Accessibility props for the interactive element
    const a11yProps = {
        role: "button" as const,
        tabIndex: 0,
        "aria-expanded": !isCollapsed,
        "aria-label": `Toggle ${label}`,
        onKeyDown: handleKeyDown,
    }

    return (
        <div
            className={cn(
                flexLayouts.rowCenter,
                "select-none rounded",
                gapClasses.xs,
                !hasCustomLabel && "cursor-pointer",
                !hasCustomLabel && focusStyles.ring,
                className,
            )}
            onClick={hasCustomLabel ? undefined : handleCaretClick}
            {...(!hasCustomLabel && a11yProps)}
        >
            <span
                className={cn(
                    "flex-shrink-0 rounded",
                    hasCustomLabel && "cursor-pointer",
                    hasCustomLabel && focusStyles.ring,
                )}
                onClick={hasCustomLabel ? handleCaretClick : undefined}
                {...(hasCustomLabel && a11yProps)}
            >
                {isCollapsed ? (
                    <CaretRight size={iconSize} className={textColors.secondary} />
                ) : (
                    <CaretDown size={iconSize} className={textColors.secondary} />
                )}
            </span>
            {renderLabel ? (
                <div className="flex-1 min-w-0">{renderLabel(label)}</div>
            ) : (
                <span>{label}</span>
            )}
            {count !== undefined && (
                <span className={cn(textColors.tertiary, textSizes.xs, "flex-shrink-0")}>
                    ({count})
                </span>
            )}
        </div>
    )
}
