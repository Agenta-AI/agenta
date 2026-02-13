import {useCallback, useEffect, useRef} from "react"

interface UseInfiniteScrollOptions {
    loadMore: () => void
    scrollThreshold?: number
}

/**
 * Hook to handle infinite scroll loading with RAF-based throttling
 */
const useInfiniteScroll = ({loadMore, scrollThreshold = 300}: UseInfiniteScrollOptions) => {
    const scrollRafRef = useRef<number | null>(null)
    const lastScrollTargetRef = useRef<HTMLDivElement | null>(null)

    const handleScroll = useCallback(
        (event: React.UIEvent<HTMLDivElement>) => {
            // Store the scroll target for RAF callback
            lastScrollTargetRef.current = event.currentTarget

            // Skip if we already have a pending RAF
            if (scrollRafRef.current !== null) {
                return
            }

            // Defer layout reads to next animation frame to avoid forced reflow during scroll
            scrollRafRef.current = requestAnimationFrame(() => {
                scrollRafRef.current = null
                const target = lastScrollTargetRef.current
                if (!target) return

                const distanceToBottom =
                    target.scrollHeight - target.scrollTop - target.clientHeight

                if (distanceToBottom < scrollThreshold) {
                    loadMore()
                }
            })
        },
        [loadMore, scrollThreshold],
    )

    // Cleanup RAF on unmount
    useEffect(() => {
        return () => {
            if (scrollRafRef.current !== null) {
                cancelAnimationFrame(scrollRafRef.current)
            }
        }
    }, [])

    return handleScroll
}

export default useInfiniteScroll
