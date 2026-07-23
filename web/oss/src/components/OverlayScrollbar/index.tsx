"use client"

import {useCallback, useEffect, useRef, useState} from "react"

interface OverlayScrollbarProps {
    /** The scroll container this thumb drives. Must be inside a positioned ancestor. */
    target: HTMLElement | null
}

interface Metrics {
    /** Thumb offset from the scroller's top edge, in pixels. */
    top: number
    height: number
    /** The scroller's own offset inside the positioned ancestor. */
    trackTop: number
    trackHeight: number
}

const MIN_THUMB_HEIGHT = 28
const SCROLL_FLASH_MS = 700

/**
 * A scrollbar drawn on top of the content instead of beside it.
 *
 * A native scrollbar takes layout width, which shortens every full-width row in the panel by the
 * scrollbar's size. This one floats, so rows still span the panel edge to edge. It shows while the
 * pointer is anywhere in the panel (CSS `group-hover`) or for a moment after a scroll, and it can
 * be dragged.
 *
 * Render it as a sibling of the scroller, inside a `relative group` ancestor.
 */
const OverlayScrollbar = ({target}: OverlayScrollbarProps) => {
    const [metrics, setMetrics] = useState<Metrics | null>(null)
    const [scrolling, setScrolling] = useState(false)
    const [dragging, setDragging] = useState(false)
    const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const measure = useCallback(() => {
        if (!target) {
            setMetrics(null)
            return
        }
        const {scrollHeight, clientHeight, scrollTop, offsetTop} = target
        const scrollable = scrollHeight - clientHeight
        if (scrollable <= 1) {
            setMetrics(null)
            return
        }
        const height = Math.max(MIN_THUMB_HEIGHT, (clientHeight / scrollHeight) * clientHeight)
        const top = (scrollTop / scrollable) * (clientHeight - height)
        setMetrics({top, height, trackTop: offsetTop, trackHeight: clientHeight})
    }, [target])

    useEffect(() => {
        if (!target) return

        const onScroll = () => {
            measure()
            setScrolling(true)
            if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
            flashTimerRef.current = setTimeout(() => setScrolling(false), SCROLL_FLASH_MS)
        }

        // The scroller keeps its own size while the content grows, and its children are swapped
        // as the panel loads, so a ResizeObserver on the child would go stale. Remeasure on any
        // subtree change instead, batched to one frame.
        let frame = 0
        const scheduleMeasure = () => {
            if (frame) return
            frame = requestAnimationFrame(() => {
                frame = 0
                measure()
            })
        }

        measure()
        target.addEventListener("scroll", onScroll, {passive: true})

        const resizeObserver = new ResizeObserver(scheduleMeasure)
        resizeObserver.observe(target)
        const mutationObserver = new MutationObserver(scheduleMeasure)
        mutationObserver.observe(target, {childList: true, subtree: true})

        return () => {
            target.removeEventListener("scroll", onScroll)
            resizeObserver.disconnect()
            mutationObserver.disconnect()
            if (frame) cancelAnimationFrame(frame)
            if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
        }
    }, [target, measure])

    const handlePointerDown = useCallback(
        (event: React.PointerEvent<HTMLDivElement>) => {
            if (!target || !metrics) return
            event.preventDefault()
            const startY = event.clientY
            const startScroll = target.scrollTop
            const scrollable = target.scrollHeight - target.clientHeight
            const travel = metrics.trackHeight - metrics.height
            setDragging(true)

            const onMove = (moveEvent: PointerEvent) => {
                if (travel <= 0) return
                const delta = ((moveEvent.clientY - startY) / travel) * scrollable
                target.scrollTop = startScroll + delta
            }
            // pointercancel too: a cancelled stream (touch interruption, app switch) never fires
            // pointerup, which would leave the drag state on and the listeners attached.
            const onUp = () => {
                setDragging(false)
                window.removeEventListener("pointermove", onMove)
                window.removeEventListener("pointerup", onUp)
                window.removeEventListener("pointercancel", onUp)
            }
            window.addEventListener("pointermove", onMove)
            window.addEventListener("pointerup", onUp)
            window.addEventListener("pointercancel", onUp)
        },
        [target, metrics],
    )

    if (!metrics) return null

    return (
        <div
            className="pointer-events-none absolute right-0 z-20 w-2"
            style={{top: metrics.trackTop, height: metrics.trackHeight}}
        >
            <div
                role="presentation"
                onPointerDown={handlePointerDown}
                className={[
                    // touch-none so a touch drag moves the thumb instead of scrolling the page.
                    "pointer-events-auto absolute right-0.5 w-1.5 cursor-default touch-none rounded-full",
                    "opacity-0 transition-opacity duration-150 group-hover:opacity-100",
                    scrolling || dragging ? "!opacity-100" : "",
                ].join(" ")}
                style={{
                    top: metrics.top,
                    height: metrics.height,
                    background: dragging
                        ? "var(--ag-scroll-thumb-hover)"
                        : "var(--ag-scroll-thumb)",
                }}
            />
        </div>
    )
}

export default OverlayScrollbar
