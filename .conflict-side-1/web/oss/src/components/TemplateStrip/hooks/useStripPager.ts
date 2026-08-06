import {useCallback, useEffect, useRef, useState} from "react"

import {computePagerState, pageDelta, type PagerState} from "../assets/pagerMath"

const INITIAL: PagerState = {atStart: true, atEnd: true, counterLabel: "", showPager: false}

/**
 * Scroll-state owner for the strip's card row: tracks the container's scroll position
 * (scroll event + ResizeObserver, so bounds stay correct on container resize) and exposes
 * the prototype-exact pager state plus page/reset actions.
 */
export function useStripPager(cardCount: number) {
    const scrollerRef = useRef<HTMLDivElement | null>(null)
    const [state, setState] = useState<PagerState>(INITIAL)

    const recompute = useCallback(() => {
        const el = scrollerRef.current
        if (!el) return
        setState(computePagerState(el.scrollLeft, el.scrollWidth, el.clientWidth, cardCount))
    }, [cardCount])

    useEffect(() => {
        const el = scrollerRef.current
        if (!el) return
        recompute()
        el.addEventListener("scroll", recompute, {passive: true})
        const observer = new ResizeObserver(recompute)
        observer.observe(el)
        return () => {
            el.removeEventListener("scroll", recompute)
            observer.disconnect()
        }
    }, [recompute])

    const pageBy = useCallback((direction: 1 | -1) => {
        scrollerRef.current?.scrollBy({left: pageDelta(direction), behavior: "smooth"})
    }, [])

    const resetScroll = useCallback(() => {
        const el = scrollerRef.current
        if (el) el.scrollLeft = 0
    }, [])

    return {scrollerRef, ...state, pageBy, resetScroll}
}
