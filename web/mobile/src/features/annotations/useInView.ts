import {useState} from "react"

import {useIntersectionObserver} from "./useIntersectionObserver"

/**
 * True once the element has been near the viewport. It stays true afterwards, so a cell that
 * started a request does not drop it when the reader scrolls on.
 *
 * Without `IntersectionObserver` (jsdom, very old browsers) the element counts as in view at
 * once, so nothing waits for a signal that never comes.
 */
export const useInView = <T extends Element>(rootMargin = "200px") => {
    const [node, setNode] = useState<T | null>(null)
    const [seen, setSeen] = useState(false)
    const inView = seen || typeof IntersectionObserver === "undefined"

    useIntersectionObserver(node, () => setSeen(true), {rootMargin, enabled: !inView})

    return {ref: setNode, inView}
}
