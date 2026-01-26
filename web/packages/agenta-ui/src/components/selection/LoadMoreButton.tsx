/**
 * LoadMoreButton Component
 *
 * A button for manually triggering pagination/infinite scroll.
 * Use instead of auto-scroll when explicit user control is preferred.
 *
 * @example
 * ```tsx
 * import {LoadMoreButton} from '@agenta/ui'
 *
 * <LoadMoreButton
 *   onClick={fetchNextPage}
 *   isLoading={isFetchingNextPage}
 *   hasMore={hasNextPage}
 *   loadedCount={items.length}
 *   totalCount={totalCount}
 *   showCount
 * />
 * ```
 */

import React from "react"

import {Button, Spin} from "antd"
import {ChevronDown} from "lucide-react"

import type {EntityListCounts} from "../../InfiniteVirtualTable/paginated"
import {
    cn,
    flexLayouts,
    gapClasses,
    justifyClasses,
    linkColors,
    textColors,
} from "../../utils/styles"

// ============================================================================
// TYPES
// ============================================================================

export interface LoadMoreButtonProps {
    /**
     * Optional: EntityListCounts object from paginated store.
     * When provided, overrides loadedCount, totalCount, and hasMore props.
     */
    counts?: EntityListCounts
    /**
     * Callback when button is clicked
     */
    onClick: () => void

    /**
     * Whether data is currently loading
     */
    isLoading?: boolean

    /**
     * Whether there are more items to load
     */
    hasMore?: boolean

    /**
     * Custom button text
     * @default "Load more"
     */
    label?: string

    /**
     * Custom loading text
     * @default "Loading..."
     */
    loadingLabel?: string

    /**
     * Total count of items (for display)
     */
    totalCount?: number | null

    /**
     * Current loaded count (for display)
     */
    loadedCount?: number

    /**
     * Show count indicator (e.g., "10 of 50")
     * @default false
     */
    showCount?: boolean

    /**
     * Button size
     * @default "middle"
     */
    size?: "small" | "middle" | "large"

    /**
     * Additional CSS class
     */
    className?: string

    /**
     * Full width button
     * @default true
     */
    block?: boolean
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Button for loading more items in a paginated list
 */
export function LoadMoreButton({
    counts,
    onClick,
    isLoading = false,
    hasMore: hasMoreProp = true,
    label = "Load more",
    loadingLabel = "Loading...",
    totalCount: totalCountProp,
    loadedCount: loadedCountProp,
    showCount = false,
    size = "middle",
    className = "",
    block = true,
}: LoadMoreButtonProps) {
    // Use counts object if provided, otherwise fall back to individual props
    const hasMore = counts?.hasMore ?? hasMoreProp
    const totalCount = counts?.totalCount ?? totalCountProp
    const loadedCount = counts?.loadedCount ?? loadedCountProp

    // Don't render if no more items
    if (!hasMore && !isLoading) {
        return null
    }

    // Build count string - use displayLabel from counts if available
    const countString = counts?.displayLabel
        ? ` (${counts.displayLabel})`
        : showCount && loadedCount !== undefined && totalCount
          ? ` (${loadedCount} of ${totalCount})`
          : showCount && loadedCount !== undefined
            ? ` (${loadedCount} loaded)`
            : ""

    return (
        <div className={cn("py-2", className)}>
            <Button
                type="default"
                size={size}
                block={block}
                onClick={onClick}
                disabled={isLoading || !hasMore}
                icon={isLoading ? <Spin size="small" /> : <ChevronDown className="w-4 h-4" />}
            >
                {isLoading ? loadingLabel : `${label}${countString}`}
            </Button>
        </div>
    )
}

// ============================================================================
// INLINE VARIANT
// ============================================================================

export interface LoadMoreInlineProps {
    onClick: () => void
    isLoading?: boolean
    hasMore?: boolean
    label?: string
    className?: string
}

/**
 * Inline "load more" link for compact layouts
 */
export function LoadMoreInline({
    onClick,
    isLoading = false,
    hasMore = true,
    label = "Load more",
    className = "",
}: LoadMoreInlineProps) {
    if (!hasMore && !isLoading) {
        return null
    }

    return (
        <div className={cn("py-2 text-center", className)}>
            {isLoading ? (
                <span
                    className={cn(
                        textColors.tertiary,
                        flexLayouts.rowCenter,
                        justifyClasses.center,
                        gapClasses.sm,
                    )}
                >
                    <Spin size="small" />
                    Loading...
                </span>
            ) : (
                <button
                    type="button"
                    onClick={onClick}
                    className={cn(linkColors.default, linkColors.hover)}
                >
                    {label}
                </button>
            )}
        </div>
    )
}

// ============================================================================
// END OF LIST INDICATOR
// ============================================================================

export interface EndOfListProps {
    /**
     * Message to show when all items are loaded
     * @default "All items loaded"
     */
    message?: string

    /**
     * Total count of items (optional)
     */
    totalCount?: number | null

    /**
     * Additional CSS class
     */
    className?: string
}

/**
 * Indicator shown when all items have been loaded
 */
export function EndOfList({
    message = "All items loaded",
    totalCount,
    className = "",
}: EndOfListProps) {
    const displayMessage = totalCount ? `${message} (${totalCount} total)` : message

    return (
        <div className={cn("py-3 text-center", textColors.quaternary, className)}>
            {displayMessage}
        </div>
    )
}
