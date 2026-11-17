import {useEffect, useRef} from "react"

import {Button} from "../components/ui/button"
import {Spinner} from "../components/ui/spinner"

/**
 * The "Load more" row under a {@link ListTable}. Draw it while the list has another page.
 *
 * With `autoLoad`, the next page also loads when the row scrolls into view. The button stays
 * for keyboard users and for a browser with no IntersectionObserver. Off by default, so a list
 * that switches to this row keeps its click-to-load behavior until it asks for more.
 */
export const ListTableLoadMore = ({
    onLoadMore,
    loading = false,
    autoLoad = false,
    label = "Load more",
}: {
    onLoadMore: () => void
    loading?: boolean
    autoLoad?: boolean
    label?: string
}) => {
    const row = useRef<HTMLDivElement>(null)
    const latest = useRef(onLoadMore)
    latest.current = onLoadMore

    useEffect(() => {
        const node = row.current
        if (!autoLoad || loading || !node || typeof IntersectionObserver === "undefined") return
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) latest.current()
        })
        observer.observe(node)
        return () => observer.disconnect()
    }, [autoLoad, loading])

    return (
        <div ref={row} className="mt-4 flex justify-center">
            <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={onLoadMore}
            >
                {loading ? <Spinner aria-hidden className="animate-spin" /> : null}
                {label}
            </Button>
        </div>
    )
}
