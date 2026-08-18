/**
 * A scrolling region that says which edge has more behind it.
 *
 * The drawer pins everything except one list, so the list's own edges are the only cue that the
 * column continues. A soft scrim appears on whichever edge currently hides rows and on neither
 * when the whole list fits — a permanent gradient would claim hidden content that is not there.
 *
 * The scrollbar itself needs nothing here: the app's global rule already paints the 6px trackless
 * thumb (`--ag-scroll-thumb`, `rgba(36,36,36,0.22)` in light) on any `overflow-y-auto` scroller.
 */
import {useCallback, useEffect, useRef, useState, type ReactNode} from "react"

import {cn} from "@agenta/ui/styles"

export interface ScrollScrimProps {
    children: ReactNode
    /** Extra classes for the scroller itself. */
    className?: string
}

/** Below this the edge counts as reached — a sub-pixel remainder is not hidden content. */
const EDGE_EPSILON = 2

const ScrollScrim = ({children, className}: ScrollScrimProps) => {
    const scrollerRef = useRef<HTMLDivElement | null>(null)
    const [edges, setEdges] = useState({top: false, bottom: false})

    const measure = useCallback(() => {
        const node = scrollerRef.current
        if (!node) return
        const top = node.scrollTop > EDGE_EPSILON
        const bottom = node.scrollTop + node.clientHeight < node.scrollHeight - EDGE_EPSILON
        setEdges((current) =>
            current.top === top && current.bottom === bottom ? current : {top, bottom},
        )
    }, [])

    // The list grows and shrinks under search and under the drawer's own resize, so the edges are
    // re-measured on content and box changes, not only on scroll.
    useEffect(() => {
        const node = scrollerRef.current
        if (!node || typeof ResizeObserver === "undefined") return
        const observer = new ResizeObserver(measure)
        observer.observe(node)
        for (const child of Array.from(node.children)) observer.observe(child)
        measure()
        return () => observer.disconnect()
    }, [measure, children])

    return (
        <div className="relative flex min-h-0 flex-1 flex-col">
            <div
                ref={scrollerRef}
                onScroll={measure}
                className={cn("min-h-0 flex-1 overflow-y-auto", className)}
            >
                {children}
            </div>
            <span
                aria-hidden
                className={cn(
                    "pointer-events-none absolute inset-x-0 top-0 h-4 bg-gradient-to-b from-colorBgContainer to-transparent transition-opacity",
                    edges.top ? "opacity-100" : "opacity-0",
                )}
            />
            <span
                aria-hidden
                className={cn(
                    "pointer-events-none absolute inset-x-0 bottom-0 h-4 bg-gradient-to-t from-colorBgContainer to-transparent transition-opacity",
                    edges.bottom ? "opacity-100" : "opacity-0",
                )}
            />
        </div>
    )
}

export default ScrollScrim
