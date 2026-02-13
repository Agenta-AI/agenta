/**
 * ListItemSkeleton Component
 *
 * A skeleton loader for list items during loading states.
 * Used in entity pickers, selection lists, and other list-based UIs.
 *
 * @example
 * ```tsx
 * import { ListItemSkeleton } from '@agenta/ui'
 *
 * {isLoading ? (
 *   <ListItemSkeleton count={4} />
 * ) : (
 *   <List items={items} />
 * )}
 * ```
 */

import {memo} from "react"

import {Skeleton} from "antd"

import {bgColors, cn, flexLayouts, spacingClasses} from "../../../utils/styles"

// ============================================================================
// TYPES
// ============================================================================

export interface ListItemSkeletonProps {
    /** Number of skeleton items to show */
    count?: number
    /** Show avatar placeholder */
    showAvatar?: boolean
    /** Avatar shape */
    avatarShape?: "circle" | "square"
    /** Additional CSS classes */
    className?: string
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * A skeleton loader that displays placeholder list items.
 * Useful for showing loading state in lists and selection UIs.
 */
export const ListItemSkeleton = memo(function ListItemSkeleton({
    count = 4,
    showAvatar = true,
    avatarShape = "square",
    className,
}: ListItemSkeletonProps) {
    return (
        <div className={cn("space-y-2", className)}>
            {Array.from({length: count}).map((_, index) => (
                <div
                    key={index}
                    className={cn(
                        flexLayouts.rowCenter,
                        spacingClasses.compact,
                        "rounded-md",
                        bgColors.subtle,
                    )}
                >
                    {showAvatar && (
                        <Skeleton.Avatar active size="small" shape={avatarShape} className="mr-3" />
                    )}
                    <div className="flex-1">
                        <Skeleton.Input active size="small" block className="!w-3/4 mb-1" />
                    </div>
                </div>
            ))}
        </div>
    )
})

export default ListItemSkeleton
