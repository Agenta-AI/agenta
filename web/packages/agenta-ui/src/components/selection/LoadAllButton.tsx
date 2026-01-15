/**
 * LoadAllButton Component
 *
 * A button that triggers loading all remaining pages in a paginated list.
 * Executes chained page fetches until all data is loaded.
 *
 * @example
 * ```tsx
 * import {LoadAllButton} from '@agenta/ui'
 *
 * <LoadAllButton
 *   onLoadAll={loadAllPages}
 *   isLoading={isLoadingAll}
 *   hasMore={hasNextPage}
 *   loadedCount={items.length}
 *   totalCount={totalCount}
 * />
 * ```
 */

import React from "react"

import {Button, Spin, Progress} from "antd"
import {Download} from "lucide-react"

// ============================================================================
// TYPES
// ============================================================================

export interface LoadAllButtonProps {
    /**
     * Callback to load all remaining pages
     * Should return a promise that resolves when all pages are loaded
     */
    onLoadAll: () => Promise<void>

    /**
     * Whether data is currently being loaded
     */
    isLoading?: boolean

    /**
     * Whether there are more items to load
     */
    hasMore?: boolean

    /**
     * Custom button text
     * @default "Load all"
     */
    label?: string

    /**
     * Custom loading text
     * @default "Loading all..."
     */
    loadingLabel?: string

    /**
     * Total count of items (for progress display)
     */
    totalCount?: number | null

    /**
     * Current loaded count (for progress display)
     */
    loadedCount?: number

    /**
     * Button size
     * @default "small"
     */
    size?: "small" | "middle" | "large"

    /**
     * Additional CSS class
     */
    className?: string

    /**
     * Full width button
     * @default false
     */
    block?: boolean
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Button that loads all remaining pages in a paginated list
 */
export function LoadAllButton({
    onLoadAll,
    isLoading = false,
    hasMore = true,
    label = "Load all",
    loadingLabel = "Loading all...",
    totalCount,
    loadedCount,
    size = "small",
    className = "",
    block = false,
}: LoadAllButtonProps) {
    // Don't render if no more items or already fully loaded
    if (!hasMore && !isLoading) {
        return null
    }

    // Calculate progress percentage
    const progressPercent =
        totalCount && loadedCount ? Math.round((loadedCount / totalCount) * 100) : undefined

    const handleClick = async () => {
        try {
            await onLoadAll()
        } catch (error) {
            console.error("Failed to load all pages:", error)
        }
    }

    return (
        <div className={`flex items-center gap-2 ${className}`}>
            <Button
                type="text"
                size={size}
                block={block}
                onClick={handleClick}
                disabled={isLoading || !hasMore}
                icon={isLoading ? <Spin size="small" /> : <Download className="w-3 h-3" />}
            >
                {isLoading ? loadingLabel : label}
            </Button>

            {/* Progress indicator when loading */}
            {isLoading && progressPercent !== undefined && (
                <Progress
                    type="circle"
                    percent={progressPercent}
                    size={20}
                    strokeWidth={10}
                    showInfo={false}
                />
            )}

            {/* Count display */}
            {!isLoading && totalCount && loadedCount && loadedCount < totalCount && (
                <span className="text-zinc-400">
                    {loadedCount} / {totalCount}
                </span>
            )}
        </div>
    )
}

// ============================================================================
// INLINE VARIANT
// ============================================================================

export interface LoadAllInlineProps {
    onLoadAll: () => Promise<void>
    isLoading?: boolean
    hasMore?: boolean
    label?: string
    className?: string
}

/**
 * Inline "load all" link for compact layouts
 */
export function LoadAllInline({
    onLoadAll,
    isLoading = false,
    hasMore = true,
    label = "Load all",
    className = "",
}: LoadAllInlineProps) {
    if (!hasMore && !isLoading) {
        return null
    }

    const handleClick = async () => {
        try {
            await onLoadAll()
        } catch (error) {
            console.error("Failed to load all pages:", error)
        }
    }

    return (
        <span className={className}>
            {isLoading ? (
                <span className="text-zinc-500 flex items-center gap-1">
                    <Spin size="small" />
                    Loading...
                </span>
            ) : (
                <button
                    type="button"
                    onClick={handleClick}
                    className="text-blue-600 hover:text-blue-800 hover:underline"
                >
                    {label}
                </button>
            )}
        </span>
    )
}
