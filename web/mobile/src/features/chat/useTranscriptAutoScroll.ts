import {useCallback, useEffect, useLayoutEffect, useRef, useState} from "react"

import {shouldRevealJump} from "@agenta/chat/assets"

/** Follow keeps tracking appends from this close to the bottom. Deliberately small and NOT the
 * pill's threshold: auto-scrolling someone who has scrolled up to read is the worse failure. */
const NEAR_BOTTOM_PX = 80

/** Starts the transcript at the latest message; follows appends only while already near the bottom. */
export const useTranscriptAutoScroll = (content: unknown) => {
    const ref = useRef<HTMLDivElement | null>(null)
    // Starts true so the first content render pins to the latest message.
    const nearBottomRef = useRef(true)
    // The jump pill is a SEPARATE, much further threshold (`shouldRevealJump`, shared with the
    // desktop): leaving the follow band means "stop auto-scrolling", not "offer a way back" — at
    // 80px the pill used to appear on barely a nudge.
    const [showJump, setShowJump] = useState(false)

    const measure = useCallback((el: HTMLDivElement) => {
        // A pane hidden behind the config split measures 0 everywhere; that is not the reader moving.
        if (el.clientHeight === 0) return
        nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX
        const next = !nearBottomRef.current && shouldRevealJump(el)
        setShowJump((prev) => (prev === next ? prev : next))
    }, [])

    const onScroll = useCallback(() => {
        const el = ref.current
        if (el) measure(el)
    }, [measure])

    const jumpToLatest = useCallback(() => {
        const el = ref.current
        if (!el) return
        nearBottomRef.current = true
        setShowJump(false)
        el.scrollTo({top: el.scrollHeight, behavior: "smooth"})
    }, [])

    useLayoutEffect(() => {
        const el = ref.current
        if (!el) return
        if (nearBottomRef.current) {
            el.scrollTop = el.scrollHeight
            return
        }
        // Parked mid-scroll: streamed growth moves the newest turn further away without firing a
        // scroll event, so re-measure on content instead of waiting for a gesture that never comes.
        measure(el)
    }, [content, measure])

    // The pin above measures at layout time, but a transcript keeps growing after that — a fence
    // finishes highlighting, an image loads, a tool card lays itself out. Without this the opening
    // pin lands on a fraction of the final height and a long chat reads as starting at the top.
    // Follow the growth while the reader is at the bottom; the moment they scroll up this no-ops.
    useEffect(() => {
        const el = ref.current
        if (!el) return
        const observer = new ResizeObserver(() => {
            if (!nearBottomRef.current || el.clientHeight === 0) return
            el.scrollTop = el.scrollHeight
        })
        observer.observe(el)
        for (const child of Array.from(el.children)) observer.observe(child)
        return () => observer.disconnect()
    }, [content])

    return {ref, onScroll, jumpToLatest, showJump}
}
