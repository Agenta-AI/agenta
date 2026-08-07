/**
 * Source Indicator Components
 *
 * Reusable components for displaying connection/source status.
 *
 * @example
 * ```tsx
 * import { SourceIndicator } from '@agenta/ui'
 *
 * <SourceIndicator
 *   icon={<Link />}
 *   name="My Testset v3"
 *   connected
 *   modified
 *   onClick={() => navigate()}
 * />
 * ```
 */

import type {ReactNode} from "react"

import {cn, entityIconColors, flexLayouts, gapClasses} from "../../../utils/styles"
import {Badge, type BadgeProps} from "../../ui/badge"

// antd Tag `color` → shadcn Badge variant.
const COLOR_VARIANT: Record<string, NonNullable<BadgeProps["variant"]>> = {
    default: "default",
    green: "green",
    orange: "orange",
    blue: "blue",
    red: "red",
}

// ============================================================================
// TYPES
// ============================================================================

export interface SourceIndicatorProps {
    /**
     * Icon to display (e.g., Link, Table, Lightning)
     */
    icon: ReactNode
    /**
     * Icon color class
     * @default entityIconColors.connected
     */
    iconColor?: string
    /**
     * Source name to display
     */
    name: string
    /**
     * Whether the source is connected (affects tag color)
     * @default true
     */
    connected?: boolean
    /**
     * Whether there are local modifications
     * @default false
     */
    modified?: boolean
    /**
     * Click handler for the tag
     */
    onClick?: () => void
    /**
     * Additional CSS class
     */
    className?: string
}

// ============================================================================
// COMPONENTS
// ============================================================================

/**
 * Displays a source connection indicator with icon and tag
 */
export function SourceIndicator({
    icon,
    iconColor = entityIconColors.connected,
    name,
    connected = true,
    modified = false,
    onClick,
    className,
}: SourceIndicatorProps) {
    const tagColor = !connected ? "default" : modified ? "orange" : "green"
    const displayName = modified ? `${name} (modified)` : name

    return (
        <div className={cn(flexLayouts.rowCenter, gapClasses.sm, className)}>
            <span className={cn("flex-shrink-0", iconColor)}>{icon}</span>
            <Badge
                variant={COLOR_VARIANT[tagColor] ?? "default"}
                className={cn(onClick && "cursor-pointer")}
                onClick={onClick}
            >
                {displayName}
            </Badge>
        </div>
    )
}
