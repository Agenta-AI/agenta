import {useEffect, useRef, type ReactNode} from "react"

import {Skeleton} from "@agenta/ui/ui"

export interface ObservabilityListProps<Item> {
    items: Item[]
    keyOf: (item: Item, index: number) => string
    renderItem: (item: Item, index: number) => ReactNode
    /** First load, before there is anything to show. */
    isLoading?: boolean
    /** A further page is on its way. */
    isLoadingMore?: boolean
    hasMore?: boolean
    loadMore?: () => void
    error?: ReactNode
    empty?: ReactNode
    className?: string
    /** How far ahead of the last row to start the next page. */
    rootMargin?: string
}

const SkeletonRows = ({count = 4}: {count?: number}) => (
    <div className="flex flex-col gap-2 px-2 py-2">
        {Array.from({length: count}, (_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
        ))}
    </div>
)

/**
 * The scroll container behind every list-shaped observability surface.
 *
 * Pure container: it owns paging, skeletons, and the error and empty slots, and nothing about
 * how a row looks. Callers pass `renderItem`, so traces and sessions can share the paging
 * behaviour without sharing a row.
 *
 * Paging is an IntersectionObserver on a sentinel after the last row rather than a scroll
 * handler, so it costs nothing per frame and keeps working if the list is nested in another
 * scroller.
 */
export const ObservabilityList = <Item,>({
    items,
    keyOf,
    renderItem,
    isLoading,
    isLoadingMore,
    hasMore,
    loadMore,
    error,
    empty,
    className,
    rootMargin = "300px",
}: ObservabilityListProps<Item>) => {
    const sentinelRef = useRef<HTMLDivElement | null>(null)
    // Read through a ref so a caller passing an inline arrow does not re-arm the observer
    // on every render.
    const loadMoreRef = useRef(loadMore)
    loadMoreRef.current = loadMore

    useEffect(() => {
        const node = sentinelRef.current
        if (!node || !hasMore || isLoadingMore) return
        if (typeof IntersectionObserver === "undefined") return

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) loadMoreRef.current?.()
            },
            {rootMargin},
        )
        observer.observe(node)
        return () => observer.disconnect()
    }, [hasMore, isLoadingMore, rootMargin, items.length])

    if (error) return <>{error}</>
    if (isLoading && items.length === 0) return <SkeletonRows />
    if (items.length === 0) return <>{empty}</>

    return (
        <div className={className}>
            {items.map((item, index) => (
                <div key={keyOf(item, index)}>{renderItem(item, index)}</div>
            ))}
            {isLoadingMore ? <SkeletonRows count={2} /> : null}
            {/* Zero-height sentinel: it must sit after the rows so it only enters the viewport
                once the user has reached the end. */}
            {hasMore ? <div ref={sentinelRef} aria-hidden className="h-px w-full" /> : null}
        </div>
    )
}

export default ObservabilityList
