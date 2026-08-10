import {useCallback, useLayoutEffect, useRef} from "react"

const NEAR_BOTTOM_PX = 80

/** Starts the transcript at the latest message; follows appends only while already near the bottom. */
export const useTranscriptAutoScroll = (content: unknown) => {
    const ref = useRef<HTMLDivElement | null>(null)
    // Starts true so the first content render pins to the latest message.
    const nearBottomRef = useRef(true)
    const onScroll = useCallback(() => {
        const el = ref.current
        if (!el) return
        nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX
    }, [])
    useLayoutEffect(() => {
        const el = ref.current
        if (!el || !nearBottomRef.current) return
        el.scrollTop = el.scrollHeight
    }, [content])
    return {ref, onScroll}
}
