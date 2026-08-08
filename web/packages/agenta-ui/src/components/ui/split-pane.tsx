import * as React from "react"

import {cn} from "./utils"

/**
 * SplitPane — a two-pane horizontal split with one DRIVEN pane (its width is a controlled
 * `paneSize` in px, rendered as `flex-basis`) and one FILL pane (`flex:1 1 auto`). Replaces the
 * antd `Splitter` uses where one side is a rail/panel and the other is the canvas.
 *
 * Because the driven basis is fully React-controlled (nothing here rewrites inline styles the way
 * antd's ResizeObserver does), open/close animation is just a CSS transition on `flex-basis`,
 * gated by `animate` — none of the pre-frame machinery the antd version needed. The one observer
 * it does keep is read-only: it supplies the divider's `aria-value*` bounds and touches no layout.
 *
 * The divider is a keyboard-operable window splitter: focusable while `resizable`, Arrow keys
 * step it (Shift for a coarse step), Home/End jump to the bounds, and every path — pointer or
 * key — runs the same `onResizeStart → onResize → onResizeEnd` cycle through the same clamp.
 *
 * The divider is the agent playground's gutter: a 9px channel (`--ag-surface-gutter`) with a
 * centred hairline and a grip pill that takes a primary tint on hover/drag (ported from
 * `.playground-splitter-agent` in globals.css).
 */
export interface SplitPaneProps {
    /** Which side the driven pane sits on. */
    paneSide: "start" | "end"
    /** Driven pane width in px (0 collapses it). Controlled. */
    paneSize: number
    paneMin?: number
    paneMax?: number
    /** The fill pane never shrinks below this during a drag. */
    fillMin?: number
    /** Divider dragging enabled. */
    resizable?: boolean
    /** Transition the driven pane's flex-basis (240ms, the playground curve). */
    animate?: boolean
    /** Hide the divider entirely (collapsed rail). The panes stay mounted. */
    barHidden?: boolean
    /** Accessible name for the divider — it is focusable whenever `resizable`. */
    barLabel?: string
    onResizeStart?: () => void
    onResize?: (size: number, total: number) => void
    onResizeEnd?: (size: number, total: number) => void
    pane: React.ReactNode
    fill: React.ReactNode
    className?: string
    paneClassName?: string
    fillClassName?: string
    barClassName?: string
}

const BAR_WIDTH = 9

const SLIDE = "[transition:flex-basis_240ms_cubic-bezier(0.4,0,0.2,1)]"

/** Keyboard resize increments — the ARIA window-splitter pattern's arrow step and its coarse
 * (modifier-held) counterpart. */
const KEY_STEP = 16
const KEY_STEP_COARSE = 64

export function SplitPane({
    paneSide,
    paneSize,
    paneMin = 0,
    paneMax = Number.POSITIVE_INFINITY,
    fillMin = 0,
    resizable = true,
    animate = false,
    barHidden = false,
    barLabel = "Resize panes",
    onResizeStart,
    onResize,
    onResizeEnd,
    pane,
    fill,
    className,
    paneClassName,
    fillClassName,
    barClassName,
}: SplitPaneProps) {
    const rootRef = React.useRef<HTMLDivElement>(null)
    const [dragging, setDragging] = React.useState(false)
    const lastRef = React.useRef<{size: number; total: number}>({size: paneSize, total: 0})
    /** Track width only so the divider can publish `aria-value*`; it never drives layout. */
    const [measuredTotal, setMeasuredTotal] = React.useState(0)

    const clamp = React.useCallback(
        (raw: number, total: number) =>
            Math.max(paneMin, Math.min(raw, paneMax, Math.max(paneMin, total - fillMin))),
        [fillMin, paneMax, paneMin],
    )

    const readTotal = React.useCallback(() => {
        const rect = rootRef.current?.getBoundingClientRect()
        return rect ? rect.width - BAR_WIDTH : lastRef.current.total
    }, [])

    React.useEffect(() => {
        const el = rootRef.current
        if (!el || typeof ResizeObserver === "undefined") return
        const read = () => setMeasuredTotal(el.getBoundingClientRect().width - BAR_WIDTH)
        read()
        const observer = new ResizeObserver(read)
        observer.observe(el)
        return () => observer.disconnect()
    }, [])

    /** Both the pointer and keyboard paths land here, so the callback contract is one contract. */
    const commit = React.useCallback(
        (size: number, total: number) => {
            lastRef.current = {size, total}
            onResize?.(size, total)
        },
        [onResize],
    )

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!resizable) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        // Seed the total up front: a press-and-release with no movement never reaches
        // `handlePointerMove`, and a `total` of 0 breaks any ratio the caller derives from it.
        lastRef.current = {size: paneSize, total: readTotal()}
        setDragging(true)
        onResizeStart?.()
    }
    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!dragging) return
        const rect = rootRef.current?.getBoundingClientRect()
        if (!rect) return
        const total = rect.width - BAR_WIDTH
        const raw =
            paneSide === "start"
                ? e.clientX - rect.left - BAR_WIDTH / 2
                : rect.right - e.clientX - BAR_WIDTH / 2
        commit(clamp(Math.round(raw), total), total)
    }
    /** `pointerup` and `pointercancel` (scroll takeover, browser gesture) share one exit — without
     * it a cancelled pointer leaves `dragging` stuck true and `onResizeEnd` never fires. */
    const handlePointerFinish = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!dragging) return
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId)
        }
        setDragging(false)
        onResizeEnd?.(lastRef.current.size, lastRef.current.total)
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (!resizable) return
        const total = readTotal()
        const step = e.shiftKey ? KEY_STEP_COARSE : KEY_STEP
        // Arrows are spatial: ArrowRight always moves the DIVIDER right, which grows a start-side
        // pane and shrinks an end-side one.
        const towardsEnd = paneSide === "start" ? 1 : -1
        let next: number
        if (e.key === "ArrowRight") next = paneSize + step * towardsEnd
        else if (e.key === "ArrowLeft") next = paneSize - step * towardsEnd
        else if (e.key === "Home") next = paneMin
        else if (e.key === "End") next = paneMax
        else return
        e.preventDefault()
        const size = clamp(next, total)
        if (size === paneSize) return
        // A keystroke is a whole gesture, so it runs the full start → resize → end cycle rather
        // than a parallel one-shot callback.
        onResizeStart?.()
        commit(size, total)
        onResizeEnd?.(size, total)
    }

    const ariaValues =
        resizable && measuredTotal > 0
            ? {
                  "aria-valuenow": Math.round(clamp(paneSize, measuredTotal)),
                  "aria-valuemin": Math.round(clamp(paneMin, measuredTotal)),
                  "aria-valuemax": Math.round(clamp(paneMax, measuredTotal)),
              }
            : undefined

    const paneNode = (
        <div
            data-slot="split-pane-pane"
            className={cn(
                // min-w-0: a flex item floors at min-content otherwise, so a pane whose content has
                // an intrinsic width would refuse to follow `paneSize` down. The basis is the truth.
                "box-border min-h-0 min-w-0 shrink-0 grow-0 overflow-hidden",
                animate && !dragging && SLIDE,
                paneClassName,
            )}
            style={{flexBasis: paneSize}}
        >
            {pane}
        </div>
    )

    const barNode = barHidden ? null : (
        <div
            data-slot="split-pane-bar"
            role="separator"
            aria-orientation="vertical"
            aria-label={resizable ? barLabel : undefined}
            {...ariaValues}
            tabIndex={resizable ? 0 : undefined}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerFinish}
            onPointerCancel={handlePointerFinish}
            onKeyDown={handleKeyDown}
            className={cn(
                "group relative z-[5] box-border h-full shrink-0 touch-none select-none bg-[var(--ag-surface-gutter)]",
                resizable &&
                    "cursor-col-resize outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring",
                barClassName,
            )}
            style={{flexBasis: BAR_WIDTH, width: BAR_WIDTH}}
        >
            {/* Centre hairline — strengthens to the border tone on hover/drag. */}
            <span
                aria-hidden
                className={cn(
                    "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-colorFillQuaternary transition-colors duration-150",
                    resizable && "group-hover:bg-colorBorder",
                    dragging && "bg-colorBorder",
                )}
            />
            {/* Grip pill — quiet at rest, a longer primary tint under the pointer. */}
            {resizable ? (
                <span
                    aria-hidden
                    className={cn(
                        "absolute left-1/2 top-1/2 h-6 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-colorTextTertiary",
                        "transition-[background,height,opacity] duration-150",
                        "group-hover:h-9 group-hover:bg-colorPrimary group-hover:opacity-70",
                        dragging && "h-9 bg-colorPrimary opacity-70",
                    )}
                />
            ) : null}
        </div>
    )

    const fillNode = (
        <div
            data-slot="split-pane-fill"
            className={cn("box-border min-h-0 min-w-0 flex-auto overflow-hidden", fillClassName)}
        >
            {fill}
        </div>
    )

    return (
        <div
            ref={rootRef}
            data-slot="split-pane"
            className={cn("flex h-full min-h-0 w-full min-w-0", className)}
        >
            {paneSide === "start" ? (
                <>
                    {paneNode}
                    {barNode}
                    {fillNode}
                </>
            ) : (
                <>
                    {fillNode}
                    {barNode}
                    {paneNode}
                </>
            )}
        </div>
    )
}
