import {memo, useEffect, useRef} from "react"

import {cn} from "../../../utils/styles"

import {DOTS_EXTENT, dotsFrame, switchTo, type AgentActivityFormat, type DotsSwitch} from "./motion"

/** How often the dots re-read their CSS colour, so a theme switch lands without a per-frame style read. */
const COLOR_READ_S = 0.5

export interface AgentActivityDotsProps {
    /** What the agent is doing; a change plays the merge-and-burst switch. */
    format: AgentActivityFormat
    /** Edge in px. 18 sits on a 13px text line. */
    size?: number
    /** Dots paint in `currentColor`; defaults to the brand primary. */
    className?: string
    /** Names the indicator for a screen reader. Omit when a visible label sits beside it. */
    label?: string
}

/** Three dots orbiting in 3D, one motion per kind of agent work. */
export const AgentActivityDots = memo(function AgentActivityDots({
    format,
    size = 18,
    className,
    label,
}: AgentActivityDotsProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const formatRef = useRef(format)

    useEffect(() => {
        formatRef.current = format
    }, [format])

    useEffect(() => {
        const canvas = canvasRef.current
        const ctx = canvas?.getContext("2d")
        if (!canvas || !ctx) return
        const reducedQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)")
        const t0 = performance.now()
        let state: DotsSwitch = {format: formatRef.current, previous: null, since: 0, mergeFrom: 0}
        let color = ""
        let colorAt = -Infinity
        let raf = 0

        const paint = (now: number) => {
            const t = (now - t0) / 1000
            state = switchTo(state, formatRef.current, t)
            if (t - colorAt >= COLOR_READ_S) {
                color = getComputedStyle(canvas).color
                colorAt = t
            }
            const dpr = Math.min(2, window.devicePixelRatio || 1)
            const px = Math.max(1, Math.round(size * dpr))
            if (canvas.width !== px) canvas.width = canvas.height = px
            const frame = dotsFrame({...state, t, reduced: !!reducedQuery?.matches})
            const unit = px / 2 / DOTS_EXTENT
            const c = px / 2

            ctx.clearRect(0, 0, px, px)
            ctx.fillStyle = color
            for (const dot of frame.dots) {
                ctx.globalAlpha = frame.alpha * dot.alpha
                ctx.beginPath()
                ctx.arc(c + dot.x * unit, c + dot.y * unit, dot.r * unit, 0, Math.PI * 2)
                ctx.fill()
            }
            raf = requestAnimationFrame(paint)
        }
        raf = requestAnimationFrame(paint)
        return () => cancelAnimationFrame(raf)
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
