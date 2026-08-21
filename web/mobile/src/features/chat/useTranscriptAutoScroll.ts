import {useCallback, useLayoutEffect, useRef, useState} from "react"

const NEAR_BOTTOM_PX = 80

/** Starts the transcript at the latest message; follows appends only while already near the bottom. */
export const useTranscriptAutoScroll = (content: unknown) => {
    const ref = useRef<HTMLDivElement | null>(null)
    // Starts true so the first content render pins to the latest message.
    const nearBottomRef = useRef(true)
    // The same fact as the ref, mirrored into state because the jump pill has to RENDER on it.
    // The ref alone drives the scroll effect and deliberately causes no re-render, which is why
    // scrolling away used to change nothing on screen.
    const [nearBottom, setNearBottom] = useState(true)

    const sync = useCallback((next: boolean) => {
        nearBottomRef.current = next
        setNearBottom((prev) => (prev === next ? prev : next))
    }, [])

    const onScroll = useCallback(() => {
        const el = ref.current
        if (!el) return
        sync(el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX)
    }, [sync])

    const jumpToLatest = useCallback(() => {
        const el = ref.current
        if (!el) return
        sync(true)
        el.scrollTo({top: el.scrollHeight, behavior: "smooth"})
    }, [sync])

    useLayoutEffect(() => {
        const el = ref.current
        if (!el || !nearBottomRef.current) return
        el.scrollTop = el.scrollHeight
    }, [content])

    return {ref, onScroll, jumpToLatest, showJump: !nearBottom}
}
