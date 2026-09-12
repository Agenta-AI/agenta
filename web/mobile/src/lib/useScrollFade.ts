import {useCallback, useEffect, useRef, useState, type CSSProperties} from "react"

/**
 * The list's own scroll state, as an edge fade — Home's list region, extracted. A hard edge at
 * the bottom of a capped box reads as the end of the list; the fade is the signal that there is
 * more below, and the top one that there is more above.
 *
 * Measured on every render, not only on scroll: content height changes under a capped box
 * without resizing it, so a list that overflows on arrival has to show the fade before it is
 * ever touched (a ResizeObserver on the scroller never fires for that).
 */
export const useScrollFade = <T extends HTMLElement>() => {
    const ref = useRef<T>(null)
    const [mask, setMask] = useState<string>("none")

    const readScroll = useCallback(() => {
        const el = ref.current
        if (!el) return
        const max = el.scrollHeight - el.clientHeight
        const top = el.scrollTop > 4
        const bottom = max > 4 && el.scrollTop < max - 4
        const next =
            !top && !bottom
                ? "none"
                : `linear-gradient(to bottom, transparent 0, #000 ${top ? "26px" : "0"}, #000 ${
                      bottom ? "calc(100% - 34px)" : "100%"
                  }, transparent 100%)`
        // Idempotent, so this is safe to call on every render.
        setMask((current) => (current === next ? current : next))
    }, [])

    useEffect(readScroll)

    // The window's width changes how many rows fit; the height they occupy is what the mask reads.
    useEffect(() => {
        window.addEventListener("resize", readScroll)
        return () => window.removeEventListener("resize", readScroll)
    }, [readScroll])

    const style: CSSProperties = {maskImage: mask, WebkitMaskImage: mask}
    return {ref, onScroll: readScroll, style}
}
