import {useCallback, useLayoutEffect, useRef, useState} from "react"

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

    return {ref, onScroll, jumpToLatest, showJump}
}
