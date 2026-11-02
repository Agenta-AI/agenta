import {useEffect, useState} from "react"

/**
 * True once the element has been near the viewport. It stays true afterwards, so a cell that
 * started a request does not drop it when the reader scrolls on.
 *
 * Without `IntersectionObserver` (jsdom, very old browsers) the element counts as in view at
 * once, so nothing waits for a signal that never comes.
 */
export const useInView = <T extends Element>(rootMargin = "200px") => {
    const [node, setNode] = useState<T | null>(null)
    const [inView, setInView] = useState(false)

    useEffect(() => {
        if (inView || !node) return
        if (typeof IntersectionObserver === "undefined") {
            setInView(true)
            return
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    setInView(true)
                    observer.disconnect()
                }
            },
            {rootMargin},
        )
        observer.observe(node)
        return () => observer.disconnect()
    }, [node, inView, rootMargin])

    return {ref: setNode, inView}
}
