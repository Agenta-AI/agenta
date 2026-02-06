/**
 * FieldItemHeader Component
 *
 * Renders the header section of a drill-in field item with:
 * - Collapse toggle (when collapsible)
 * - Title (clickable when drillable)
 * - Meta information (item count)
 */

import {useCallback} from "react"

import type {PathItem, DataPath} from "@agenta/shared/utils"
import {ChevronRight, ChevronDown} from "lucide-react"

// ============================================================================
// TYPES
// ============================================================================

export interface FieldItemHeaderProps {
    /**
     * Field item being rendered
     */
    item: PathItem

    /**
     * Full path to this field
     */
    fullPath: DataPath

    /**
     * Whether the field is collapsed
     */
    isCollapsed: boolean

    /**
     * Whether the field can be collapsed
     */
    canCollapse: boolean

    /**
     * Whether the field is expandable (has children)
     */
    isExpandable: boolean

    /**
     * Child count (for expandable fields)
     */
    childCount?: number

    /**
     * Whether the field can be drilled into
     */
    canDrillIn: boolean

    /**
     * Handler for toggling collapse state
     */
    onToggleCollapse: () => void

    /**
     * Handler for drilling into the field
     */
    onDrillIn: () => void

    /**
     * CSS class names
     */
    classNames: {
        fieldHeader?: string
        fieldHeaderTitle?: string
        fieldHeaderMeta?: string
    }

    /**
     * CSS styles
     */
    styles?: {
        fieldHeader?: React.CSSProperties
        fieldHeaderTitle?: React.CSSProperties
        fieldHeaderMeta?: React.CSSProperties
    }
}

// ============================================================================
// COMPONENT
// ============================================================================

export function FieldItemHeader({
    item,
    isCollapsed,
    canCollapse,
    isExpandable,
    childCount,
    canDrillIn,
    onToggleCollapse,
    onDrillIn,
    classNames,
    styles,
}: FieldItemHeaderProps) {
    const handleTitleClick = useCallback(() => {
        if (canDrillIn) {
            onDrillIn()
        }
    }, [canDrillIn, onDrillIn])

    const handleTitleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (canDrillIn && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault()
                onDrillIn()
            }
        },
        [canDrillIn, onDrillIn],
    )

    return (
        <div className={classNames.fieldHeader} style={styles?.fieldHeader}>
            {/* Collapse toggle */}
            {canCollapse && isExpandable && (
                <button
                    type="button"
                    onClick={onToggleCollapse}
                    className="mr-1 p-0.5 hover:bg-gray-100 rounded"
                    aria-label={isCollapsed ? "Expand" : "Collapse"}
                >
                    {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                </button>
            )}

            {/* Title */}
            <span
                className={classNames.fieldHeaderTitle}
                style={styles?.fieldHeaderTitle}
                onClick={canDrillIn ? handleTitleClick : undefined}
                onKeyDown={canDrillIn ? handleTitleKeyDown : undefined}
                role={canDrillIn ? "button" : undefined}
                tabIndex={canDrillIn ? 0 : undefined}
            >
                {item.name}
            </span>

            {/* Meta (item count) */}
            {childCount !== undefined && (
                <span className={classNames.fieldHeaderMeta} style={styles?.fieldHeaderMeta}>
                    ({childCount} {childCount === 1 ? "item" : "items"})
                </span>
            )}
        </div>
    )
}

export default FieldItemHeader
