import {type RefObject, useEffect, useLayoutEffect, useRef, useState} from "react"

import {flushSync} from "react-dom"

import {openWindow, settleWindow, wantsOlderTurns, widenWindow} from "./transcriptWindow"
import {NEAR_BOTTOM_PX} from "./useTranscriptAutoScroll"

/**
 * The index of the first turn to render: the tail at first, older turns as the reader scrolls up.
 * Added rows never move what is on screen. `useTranscriptAutoScroll` keys on content, which a
 * widening does not change, so it neither follows nor reads the reader as leaving.
 */
export const useTranscriptWindow = (
    total: number,
    scrollerRef: RefObject<HTMLDivElement | null>,
): number => {
    const [held, setHeld] = useState(() => openWindow(total))
    const settled = settleWindow(held, total)
    if (settled !== held) setHeld(settled)
    const {start} = settled
    const hasOlder = start > 0
    const distanceFromBottomRef = useRef<number | null>(null)

    useEffect(() => {
        const el = scrollerRef.current
        if (!el || !hasOlder) return
        const widen = () => {
            distanceFromBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight
            setHeld(widenWindow)
        }
        // The auto-scroll also moves up, to anchor an answer; only the reader's scrolling counts.
        let readerScrolled = false
        const onReaderInput = () => {
            readerScrolled = true
        }
        let lastTop = el.scrollTop
        const onScroll = () => {
            const movedUp = readerScrolled && el.scrollTop < lastTop
            lastTop = el.scrollTop
            // Synchronous: a streamed commit landing after the measure would skew the restore.
            if (wantsOlderTurns(el, movedUp, NEAR_BOTTOM_PX)) flushSync(widen)
        }
        // Content too short to scroll gives the reader no scroll event to ask with.
        const observer = new ResizeObserver(() => {
            if (wantsOlderTurns(el, false, NEAR_BOTTOM_PX)) flushSync(widen)
        })
        observer.observe(el)
        for (const child of Array.from(el.children)) observer.observe(child)
        const readerInputs = ["wheel", "touchmove", "pointerdown", "keydown"]
        for (const type of readerInputs) el.addEventListener(type, onReaderInput, {passive: true})
        el.addEventListener("scroll", onScroll, {passive: true})
        return () => {
            observer.disconnect()
            el.removeEventListener("scroll", onScroll)
            for (const type of readerInputs) el.removeEventListener(type, onReaderInput)
        }
    }, [hasOlder, scrollerRef])

    useLayoutEffect(() => {
        const el = scrollerRef.current
        const distance = distanceFromBottomRef.current
        if (!el || distance === null) return
        distanceFromBottomRef.current = null
        // Absolute, so it lands the same whether or not browser scroll anchoring already moved it.
        el.scrollTop = el.scrollHeight - el.clientHeight - distance
    }, [scrollerRef, start])

    return start
}
