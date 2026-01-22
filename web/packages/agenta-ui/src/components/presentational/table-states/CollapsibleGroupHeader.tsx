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
 * <CollapsibleGroupHeader
 *   label="inputs"
 *   isCollapsed={false}
 *   count={3}
 *   onClick={() => toggleCollapse('inputs')}
 * />
 * ```
 */

import {CaretDown, CaretRight} from "@phosphor-icons/react"

import {cn, textColors} from "../../../utils/styles"

export interface CollapsibleGroupHeaderProps {
    /** Group label to display */
    label: string
    /** Whether the group is currently collapsed */
    isCollapsed: boolean
    /** Optional count or label to display (e.g., number of columns or "collapsed") */
    count?: number | string
    /** Click handler for toggling collapse state */
    onClick?: (e: React.MouseEvent) => void
    /** Additional CSS class names */
    className?: string
}

export function CollapsibleGroupHeader({
    label,
    isCollapsed,
    count,
    onClick,
    className,
}: CollapsibleGroupHeaderProps) {
    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation()
        onClick?.(e)
    }

    return (
        <div
            className={cn("flex items-center gap-1 cursor-pointer select-none", className)}
            onClick={handleClick}
        >
            {isCollapsed ? (
                <CaretRight size={14} className={textColors.secondary} />
            ) : (
                <CaretDown size={14} className={textColors.secondary} />
            )}
            <span>{label}</span>
            {count !== undefined && (
                <span className={cn(textColors.tertiary, "text-xs")}>({count})</span>
            )}
        </div>
    )
}
