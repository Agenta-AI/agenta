import {useEffect, useRef} from "react"

/**
 * Call `onIntersect` each time `node` comes near the viewport, while `enabled`. It does nothing
 * without `IntersectionObserver` (jsdom, very old browsers).
 */
export const useIntersectionObserver = (
    node: Element | null,
    onIntersect: () => void,
    {rootMargin, enabled = true}: {rootMargin: string; enabled?: boolean},
) => {
    const latest = useRef(onIntersect)
    latest.current = onIntersect

    useEffect(() => {
        if (!node || !enabled || typeof IntersectionObserver === "undefined") return
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) latest.current()
            },
            {rootMargin},
        )
        observer.observe(node)
        return () => observer.disconnect()
    }, [node, enabled, rootMargin])
}
