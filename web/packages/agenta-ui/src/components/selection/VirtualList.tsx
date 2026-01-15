/**
 * VirtualList Component
 *
 * A virtualized list component for rendering large lists efficiently.
 * Uses @tanstack/react-virtual for windowed rendering.
 *
 * Features:
 * - Only renders visible items + overscan
 * - Scroll-based infinite loading trigger
 * - Optional "Load More" button mode
 * - Loading states for initial and incremental loads
 *
 * @example
 * ```tsx
 * import {VirtualList} from '@agenta/ui'
 *
 * <VirtualList
 *   items={entities}
 *   renderItem={(item, index) => <ListItem {...item} />}
 *   maxHeight={400}
 *   onEndReached={fetchNextPage}
 *   hasMore={hasNextPage}
 *   isFetchingMore={isFetchingNextPage}
 * />
 * ```
 */

import React, {useRef, useEffect} from "react"

import {useVirtualizer} from "@tanstack/react-virtual"
import {Spin} from "antd"

// ============================================================================
// TYPES
// ============================================================================

export interface VirtualListProps<T> {
    /**
     * Items to render
     */
    items: T[]

    /**
     * Render function for each item
     */
    renderItem: (item: T, index: number) => React.ReactNode

    /**
     * Estimated size of each item in pixels
     * @default 48
     */
    estimateSize?: number

    /**
     * Number of items to render outside visible area
     * @default 5
     */
    overscan?: number

    /**
     * Maximum height of the list container
     */
    maxHeight: number | string

    /**
     * Callback when scrolled near the end of the list
     * Used for infinite scroll loading
     */
    onEndReached?: () => void

    /**
     * Distance from end (in pixels) at which to trigger onEndReached
     * @default 200
     */
    endReachedThreshold?: number

    /**
     * Whether initial data is loading
     */
    isLoading?: boolean

    /**
     * Whether more data is being fetched
     */
    isFetchingMore?: boolean

    /**
     * Whether there are more items to load
     */
    hasMore?: boolean

    /**
     * Loading message to display
     */
    loadingMessage?: string

    /**
     * Additional CSS class for the container
     */
    className?: string

    /**
     * Get unique key for an item
     */
    getItemKey?: (item: T, index: number) => string | number
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Virtualized list with infinite scroll support
 */
export function VirtualList<T>({
    items,
    renderItem,
    estimateSize = 48,
    overscan = 5,
    maxHeight,
    onEndReached,
    endReachedThreshold = 200,
    isLoading = false,
    isFetchingMore = false,
    hasMore = false,
    loadingMessage = "Loading...",
    className = "",
    getItemKey,
}: VirtualListProps<T>) {
    const parentRef = useRef<HTMLDivElement>(null)
    const loadMoreTriggeredRef = useRef(false)

    // Initialize virtualizer
    const virtualizer = useVirtualizer({
        count: items.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => estimateSize,
        overscan,
        getItemKey: getItemKey ? (index) => getItemKey(items[index], index) : undefined,
    })

    const virtualItems = virtualizer.getVirtualItems()

    // Handle infinite scroll
    useEffect(() => {
        if (!onEndReached || !hasMore || isFetchingMore || isLoading) {
            loadMoreTriggeredRef.current = false
            return
        }

        const scrollElement = parentRef.current
        if (!scrollElement) return

        const handleScroll = () => {
            const {scrollTop, scrollHeight, clientHeight} = scrollElement
            const distanceFromEnd = scrollHeight - scrollTop - clientHeight

            if (distanceFromEnd < endReachedThreshold && !loadMoreTriggeredRef.current) {
                loadMoreTriggeredRef.current = true
                onEndReached()
            } else if (distanceFromEnd >= endReachedThreshold) {
                loadMoreTriggeredRef.current = false
            }
        }

        scrollElement.addEventListener("scroll", handleScroll, {passive: true})

        // Check initial state (in case list is already scrolled or short)
        handleScroll()

        return () => {
            scrollElement.removeEventListener("scroll", handleScroll)
        }
    }, [onEndReached, hasMore, isFetchingMore, isLoading, endReachedThreshold])

    // Reset load more trigger when items change
    useEffect(() => {
        loadMoreTriggeredRef.current = false
    }, [items.length])

    // Calculate container style
    const containerStyle: React.CSSProperties = {
        maxHeight: typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight,
        overflow: "auto",
    }

    // Loading state
    if (isLoading) {
        return (
            <div
                className={`flex items-center justify-center py-8 ${className}`}
                style={containerStyle}
            >
                <Spin size="default" />
                <span className="ml-2 text-gray-500">{loadingMessage}</span>
            </div>
        )
    }

    // Empty state
    if (items.length === 0) {
        return null // Let parent handle empty state
    }

    return (
        <div ref={parentRef} className={className} style={containerStyle}>
            <div
                style={{
                    height: `${virtualizer.getTotalSize()}px`,
                    width: "100%",
                    position: "relative",
                }}
            >
                {virtualItems.map((virtualItem) => {
                    const item = items[virtualItem.index]
                    return (
                        <div
                            key={virtualItem.key}
                            data-index={virtualItem.index}
                            ref={virtualizer.measureElement}
                            style={{
                                position: "absolute",
                                top: 0,
                                left: 0,
                                width: "100%",
                                transform: `translateY(${virtualItem.start}px)`,
                            }}
                        >
                            {renderItem(item, virtualItem.index)}
                        </div>
                    )
                })}
            </div>

            {/* Loading indicator for fetching more */}
            {isFetchingMore && (
                <div className="flex items-center justify-center py-4">
                    <Spin size="small" />
                    <span className="ml-2 text-gray-500">Loading more...</span>
                </div>
            )}
        </div>
    )
}

// ============================================================================
// SIMPLE LIST (Non-virtualized fallback)
// ============================================================================

export interface SimpleListProps<T> {
    items: T[]
    renderItem: (item: T, index: number) => React.ReactNode
    maxHeight: number | string
    isLoading?: boolean
    isFetchingMore?: boolean
    loadingMessage?: string
    className?: string
}

/**
 * Simple non-virtualized list for small datasets
 * Use this when item count is < 100 and virtualization overhead isn't worth it
 */
export function SimpleList<T>({
    items,
    renderItem,
    maxHeight,
    isLoading = false,
    isFetchingMore = false,
    loadingMessage = "Loading...",
    className = "",
}: SimpleListProps<T>) {
    const containerStyle: React.CSSProperties = {
        maxHeight: typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight,
        overflowY: "auto",
    }

    if (isLoading) {
        return (
            <div
                className={`flex items-center justify-center py-8 ${className}`}
                style={containerStyle}
            >
                <Spin size="default" />
                <span className="ml-2 text-gray-500">{loadingMessage}</span>
            </div>
        )
    }

    return (
        <div className={className} style={containerStyle}>
            <div className="space-y-1">
                {items.map((item, index) => (
                    <React.Fragment key={index}>{renderItem(item, index)}</React.Fragment>
                ))}
            </div>

            {isFetchingMore && (
                <div className="flex items-center justify-center py-4">
                    <Spin size="small" />
                    <span className="ml-2 text-gray-500">Loading more...</span>
                </div>
            )}
        </div>
    )
}

// ============================================================================
// ADAPTIVE LIST (Auto-selects based on item count)
// ============================================================================

export interface AdaptiveListProps<T> extends VirtualListProps<T> {
    /**
     * Threshold for switching to virtual list
     * @default 50
     */
    virtualizeThreshold?: number
}

/**
 * Adaptive list that automatically uses virtualization for large lists
 */
export function AdaptiveList<T>({virtualizeThreshold = 50, ...props}: AdaptiveListProps<T>) {
    const shouldVirtualize = props.items.length >= virtualizeThreshold

    if (shouldVirtualize) {
        return <VirtualList {...props} />
    }

    return (
        <SimpleList
            items={props.items}
            renderItem={props.renderItem}
            maxHeight={props.maxHeight}
            isLoading={props.isLoading}
            isFetchingMore={props.isFetchingMore}
            loadingMessage={props.loadingMessage}
            className={props.className}
        />
    )
}

// Also export with "Entity" prefix for backward compatibility
export {VirtualList as VirtualEntityList}
export {SimpleList as SimpleEntityList}
export {AdaptiveList as AdaptiveEntityList}
export type {VirtualListProps as VirtualEntityListProps}
export type {SimpleListProps as SimpleEntityListProps}
export type {AdaptiveListProps as AdaptiveEntityListProps}
