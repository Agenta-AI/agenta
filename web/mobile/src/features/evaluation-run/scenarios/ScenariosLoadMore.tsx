import {useEffect, useRef} from "react"

import {Button} from "@agenta/ui/ui"

/**
 * The end of the list. Reaching it loads the next page; the button does the same for keyboard
 * users and for a browser that cannot watch the scroll.
 */
export const ScenariosLoadMore = ({
    loading,
    onLoadMore,
}: {
    loading: boolean
    onLoadMore: () => void
}) => {
    const sentinel = useRef<HTMLDivElement>(null)
    const latest = useRef(onLoadMore)
    latest.current = onLoadMore

    useEffect(() => {
        const node = sentinel.current
        if (!node || loading || typeof IntersectionObserver === "undefined") return
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) latest.current()
        })
        observer.observe(node)
        return () => observer.disconnect()
    }, [loading])

    return (
        <div ref={sentinel} className="flex justify-center py-3">
            <Button variant="outline" disabled={loading} onClick={onLoadMore}>
                {loading ? "Loading…" : "Load more"}
            </Button>
        </div>
    )
}
