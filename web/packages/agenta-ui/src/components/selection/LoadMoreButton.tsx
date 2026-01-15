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

// ============================================================================
// TYPES
// ============================================================================

export interface LoadMoreButtonProps {
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
    onClick,
    isLoading = false,
    hasMore = true,
    label = "Load more",
    loadingLabel = "Loading...",
    totalCount,
    loadedCount,
    showCount = false,
    size = "middle",
    className = "",
    block = true,
}: LoadMoreButtonProps) {
    // Don't render if no more items
    if (!hasMore && !isLoading) {
        return null
    }

    // Build count string
    const countString =
        showCount && loadedCount !== undefined && totalCount
            ? ` (${loadedCount} of ${totalCount})`
            : showCount && loadedCount !== undefined
              ? ` (${loadedCount} loaded)`
              : ""

    return (
        <div className={`py-2 ${className}`}>
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
        <div className={`py-2 text-center ${className}`}>
            {isLoading ? (
                <span className="text-zinc-500 flex items-center justify-center gap-2">
                    <Spin size="small" />
                    Loading...
                </span>
            ) : (
                <button
                    type="button"
                    onClick={onClick}
                    className="text-blue-600 hover:text-blue-800 hover:underline"
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

    return <div className={`py-3 text-center text-zinc-400 ${className}`}>{displayMessage}</div>
}
