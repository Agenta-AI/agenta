/**
 * LoadingSkeleton Component
 *
 * A skeleton loader for loading states, with two layouts:
 *  - `paragraph` — stacked text rows (default), for table/content loading.
 *  - `list` — repeated avatar + line rows, for entity pickers and selection lists.
 *
 * Built on the @agenta/ui `Skeleton` primitives (not raw antd).
 *
 * antd → @agenta/ui mapping, 1:1 with the two components this merged:
 *  - `paragraph` = `TableLoadingState` = `<Skeleton active paragraph={{rows}} />`. antd's
 *    default `title` bar is part of that render (38% wide, above the rows) and is kept, so
 *    the placeholder is unchanged from what the app shipped pre-migration.
 *  - `list` = `ListItemSkeleton` = per row `p-3 rounded-md bg-zinc-1` with
 *    `Skeleton.Avatar active size="small"` → `SkeletonAvatar` and
 *    `Skeleton.Input active size="small" block !w-3/4 mb-1` → `SkeletonBlock h-6 !w-3/4 mb-1`
 *    (antd's small element height is the app's `controlHeightSM` = 24px = `h-6`).
 *
 * @example
 * ```tsx
 * import { LoadingSkeleton } from '@agenta/ui'
 *
 * <LoadingSkeleton rows={8} />                       // paragraph (default)
 * <LoadingSkeleton variant="list" count={4} />       // list items
 * ```
 */

import {memo} from "react"

import {bgColors, cn, flexLayouts, spacingClasses} from "../../../utils/styles"
import {Skeleton, SkeletonAvatar, SkeletonBlock} from "../../ui/skeleton"

// ============================================================================
// TYPES
// ============================================================================

export interface LoadingSkeletonProps {
    /** Layout variant (default: "paragraph") */
    variant?: "paragraph" | "list"
    /** paragraph: number of skeleton rows (default: 8) */
    rows?: number
    /** list: number of skeleton items (default: 4) */
    count?: number
    /** list: show avatar placeholder (default: true) */
    showAvatar?: boolean
    /** list: avatar shape (default: "square") */
    avatarShape?: "circle" | "square"
    /** Additional CSS class names */
    className?: string
}

// ============================================================================
// COMPONENT
// ============================================================================

export const LoadingSkeleton = memo(function LoadingSkeleton({
    variant = "paragraph",
    rows = 8,
    count = 4,
    showAvatar = true,
    avatarShape = "square",
    className,
}: LoadingSkeletonProps) {
    if (variant === "list") {
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
                            <SkeletonAvatar
                                active
                                size="small"
                                shape={avatarShape}
                                className="mr-3"
                            />
                        )}
                        <div className="flex-1">
                            <SkeletonBlock active className="h-6 !w-3/4 mb-1" />
                        </div>
                    </div>
                ))}
            </div>
        )
    }

    return (
        <div className={cn("space-y-2", className)}>
            <Skeleton active paragraph={{rows}} />
        </div>
    )
})

export default LoadingSkeleton
