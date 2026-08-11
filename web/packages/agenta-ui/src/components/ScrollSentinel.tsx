import {useEffect, useRef} from "react"

interface ScrollSentinelProps {
    onVisible: () => void
    hasMore: boolean
    isFetching: boolean
    /**
     * Scroll container to observe against. Pass this when the list scrolls inside an
     * `overflow` element (not the viewport) so `rootMargin` actually buffers the prefetch.
     */
    root?: Element | null
    /** Observer margin; widen the bottom (e.g. "0px 0px 600px 0px") for off-screen prefetch. */
    rootMargin?: string
}

export default function ScrollSentinel({
    onVisible,
    hasMore,
    isFetching,
    root,
    rootMargin = "200px",
}: ScrollSentinelProps) {
    const ref = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const el = ref.current
        if (!el || !hasMore) return

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting && !isFetching) {
                    onVisible()
                }
            },
            {root: root ?? null, rootMargin},
        )
        observer.observe(el)
        return () => observer.disconnect()
    }, [onVisible, hasMore, isFetching, root, rootMargin])

    if (!hasMore) return null

    return <div ref={ref} className="h-0 w-0" />
}
