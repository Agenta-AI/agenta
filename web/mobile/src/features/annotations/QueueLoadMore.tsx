import {useState} from "react"

import {SkeletonBlock} from "@agenta/ui/ui"

import {useIntersectionObserver} from "./useIntersectionObserver"

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

    useIntersectionObserver(node, onLoadMore, {
        rootMargin: "300px",
        enabled: hasMore && !isLoadingMore,
    })

    if (!hasMore) return null
    return (
        <div ref={setNode} className="py-3" aria-hidden>
            {isLoadingMore ? <SkeletonBlock className="h-4 w-full" /> : <div className="h-4" />}
        </div>
    )
}
