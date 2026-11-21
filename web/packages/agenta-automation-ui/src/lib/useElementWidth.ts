import {useCallback, useRef, useState} from "react"

/**
 * The width of an element, kept current with a `ResizeObserver`. Returns a callback ref and the
 * width in px (0 until the element is measured).
 *
 * For layouts that follow their CONTAINER, not the window: a 440px panel on a 1440px window must
 * lay out like a narrow screen.
 */
export const useElementWidth = <T extends HTMLElement>() => {
    const [width, setWidth] = useState(0)
    const observer = useRef<ResizeObserver | null>(null)
    const ref = useCallback((element: T | null) => {
        observer.current?.disconnect()
        observer.current = null
        if (!element) return
        setWidth(element.getBoundingClientRect().width)
        if (typeof ResizeObserver === "undefined") return
        observer.current = new ResizeObserver((entries) => {
            const entry = entries[entries.length - 1]
            if (entry) setWidth(entry.contentRect.width)
        })
        observer.current.observe(element)
    }, [])
    return [ref, width] as const
}
