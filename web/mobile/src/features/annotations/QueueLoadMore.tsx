import {useEffect, useState} from "react"

import {SkeletonBlock} from "@agenta/ui/ui"

/**
 * The end of the list. It asks for the next page each time it comes near the viewport, as long
 * as the server has more. Without `IntersectionObserver` nothing loads on scroll.
 */
export const QueueLoadMore = ({
    hasMore,
    isLoadingMore,
    onLoadMore,
}: {
    hasMore: boolean
    isLoadingMore: boolean
    onLoadMore: () => void
}) => {
    const [node, setNode] = useState<HTMLDivElement | null>(null)

    useEffect(() => {
        if (!node || !hasMore || isLoadingMore || typeof IntersectionObserver === "undefined") {
            return
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) onLoadMore()
            },
            {rootMargin: "300px"},
        )
        observer.observe(node)
        return () => observer.disconnect()
    }, [node, hasMore, isLoadingMore, onLoadMore])

    if (!hasMore) return null
    return (
        <div ref={setNode} className="py-3" aria-hidden>
            {isLoadingMore ? <SkeletonBlock className="h-4 w-full" /> : <div className="h-4" />}
        </div>
    )
}
