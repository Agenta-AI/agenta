import {memo, useEffect, useRef} from "react"

import {cn} from "../../../utils/styles"

import {
    DOTS_EXTENT,
    LEAF_BOX,
    LEAF_HEIGHT,
    LEAF_PATH,
    dotsFrame,
    switchTo,
    type AgentActivityFormat,
    type DotsSwitch,
} from "./motion"

export interface AgentActivityDotsProps {
    /** What the agent is doing; a change plays the merge-and-burst switch. `idle` shows the leaf. */
    format: AgentActivityFormat
    /** Edge in px. 14 sits on a 13px text line. */
    size?: number
    /** Dots paint in `currentColor`; defaults to the brand primary. */
    className?: string
    /** Names the indicator for a screen reader. Omit when a visible label sits beside it. */
    label?: string
}

let leafPath: Path2D | null = null

/** Three dots orbiting in 3D, one motion per kind of agent work; the Agenta leaf at rest. */
export const AgentActivityDots = memo(function AgentActivityDots({
    format,
    size = 14,
    className,
    label,
}: AgentActivityDotsProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const formatRef = useRef(format)
    const wakeRef = useRef<() => void>(() => undefined)

    useEffect(() => {
        formatRef.current = format
        wakeRef.current()
    }, [format])

    useEffect(() => {
        const canvas = canvasRef.current
        const ctx = canvas?.getContext("2d")
        if (!canvas || !ctx) return
        leafPath ??= new Path2D(LEAF_PATH)
        const reducedQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)")
        const t0 = performance.now()
        let state: DotsSwitch = {format: formatRef.current, previous: null, since: 0, mergeFrom: 0}
        let raf = 0

        const paint = (now: number) => {
            raf = 0
            const t = (now - t0) / 1000
            state = switchTo(state, formatRef.current, t)
            const dpr = Math.min(2, window.devicePixelRatio || 1)
            const px = Math.max(1, Math.round(size * dpr))
            if (canvas.width !== px) canvas.width = canvas.height = px
            const frame = dotsFrame({...state, t, reduced: !!reducedQuery?.matches})
            const unit = px / 2 / DOTS_EXTENT
            const c = px / 2

            ctx.setTransform(1, 0, 0, 1, 0, 0)
            ctx.clearRect(0, 0, px, px)
            ctx.fillStyle = getComputedStyle(canvas).color
            for (const dot of frame.dots) {
                ctx.globalAlpha = frame.alpha * dot.alpha
                ctx.beginPath()
                ctx.arc(c + dot.x * unit, c + dot.y * unit, dot.r * unit, 0, Math.PI * 2)
                ctx.fill()
            }
            if (frame.leaf > 0.002 && leafPath) {
                const sc = ((LEAF_HEIGHT * unit) / LEAF_BOX.height) * frame.leaf
                ctx.globalAlpha = frame.alpha
                ctx.setTransform(sc, 0, 0, sc, c - LEAF_BOX.cx * sc, c - LEAF_BOX.cy * sc)
                ctx.fill(leafPath)
            }
            // A settled leaf is still: stop painting until something changes.
            if (frame.animating) raf = requestAnimationFrame(paint)
        }
        const wake = () => {
            if (!raf) raf = requestAnimationFrame(paint)
        }
        wakeRef.current = wake
        wake()

        // The colour comes from CSS: repaint a still leaf when the theme or motion setting flips.
        const themeObserver = new MutationObserver(wake)
        themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ["class", "data-theme", "style"]})
        reducedQuery?.addEventListener?.("change", wake)
        return () => {
            cancelAnimationFrame(raf)
            themeObserver.disconnect()
            reducedQuery?.removeEventListener?.("change", wake)
            wakeRef.current = () => undefined
        }
    }, [size])

    return (
        <canvas
            ref={canvasRef}
            width={size}
            height={size}
            style={{width: size, height: size}}
            className={cn("block shrink-0 text-colorPrimary", className)}
            role={label ? "img" : undefined}
            aria-label={label}
            aria-hidden={label ? undefined : true}
        />
    )
})
