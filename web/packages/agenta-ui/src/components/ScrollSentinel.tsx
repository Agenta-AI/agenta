import {useEffect, useRef} from "react"

interface ScrollSentinelProps {
    onVisible: () => void
    hasMore: boolean
    isFetching: boolean
}

export default function ScrollSentinel({onVisible, hasMore, isFetching}: ScrollSentinelProps) {
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
            {rootMargin: "200px"},
        )
        observer.observe(el)
        return () => observer.disconnect()
    }, [onVisible, hasMore, isFetching])

    if (!hasMore) return null

    return <div ref={ref} className="h-0 w-0" />
}
