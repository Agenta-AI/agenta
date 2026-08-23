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
 * The divider is the agent playground's seam: the panes sit FLUSH and the divider is painted on
 * the seam itself — a 2px hairline plus a grip pill that takes a primary tint on hover/drag
 * (ported from `.playground-splitter-agent` in globals.css). The bar carries no layout width, so
 * the grab target is a wider invisible overlay centred on the seam.
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
    /** Collapse the divider to zero width (collapsed rail). It stays MOUNTED and, while
     * `animate`, closes on the same curve as the driven pane — unmounting it moved the fill 9px in
     * the first frame of a collapse, which read as a snap before the slide. */
    barHidden?: boolean
    /** Let the driven pane grow past `paneSize` — for one-pane layouts where the fill is hidden. */
    paneGrow?: boolean
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

/**
 * The bar carries NO layout width: the agent playground's panes sit flush and the divider is
 * PAINTED on the seam, which is what `.playground-splitter-agent` did (`flex-basis: 0; width: 0`).
 * A tinted gutter channel here made the two seams read differently from each other, because each
 * one's neighbouring surfaces differ.
 */
const BAR_WIDTH = 0

/** Invisible hit-slop centred on the seam — the visible pixels are only 2-4px wide. */
const BAR_HIT_WIDTH = 12

/** The pane slide's duration. Slow it down to inspect the motion — see `paneSlideMs` below. */
export const PANE_SLIDE_MS = 240

const PANE_SLIDE_CURVE = "cubic-bezier(0.4,0,0.2,1)"

/**
 * The pane slide's duration, in ms. Overridable at runtime so the motion can be slowed down and
 * inspected without a rebuild:
 *
 *     localStorage.setItem("agenta:debug:pane-slide-ms", "2500")   // then toggle the pane
 *     localStorage.removeItem("agenta:debug:pane-slide-ms")        // back to the built-in value
 *
 * Read per render (a toggle re-renders, so a new value takes effect on the next one). Hosts hold
 * their transition class for `paneSlideHoldMs()` so the class never leaves before the slide ends —
 * scale them together or the pane snaps at the tail.
 */
export const paneSlideMs = (): number => {
    if (typeof window === "undefined") return PANE_SLIDE_MS
    const raw = Number(window.localStorage?.getItem("agenta:debug:pane-slide-ms"))
    return Number.isFinite(raw) && raw > 0 ? raw : PANE_SLIDE_MS
}

/** How long a host must keep its `animate` flag on to cover the whole slide. */
export const paneSlideHoldMs = (): number => paneSlideMs() + 40

/**
 * The open/close slide, as a hook, because getting it right is subtle enough that two hosts
 * writing it twice means one of them snaps.
 *
 * Three things have to line up:
 * - `justToggled` comes from a REF, not state. A render-phase `setPrev` makes React re-render
 *   before committing, and the re-render sees `prev === open`, so the flag was always false in the
 *   committed output and the transition class only arrived in an effect — after the new width had
 *   already painted, which IS the snap.
 * - `holdAnimate` keeps the class for the whole slide, so removing it cannot cut the tail short.
 * - `keepMounted` holds the pane's CONTENT through a close, so it slides out instead of blanking
 *   to an empty sliver first.
 *
 * ```tsx
 * const {animate, keepMounted} = usePaneSlide(open, dragging)
 * <SplitPane animate={animate} paneSize={open ? width : 0} barHidden={!open}
 *            pane={keepMounted ? panel : null} … />
 * ```
 */
export const usePaneSlide = (open: boolean, dragging = false) => {
    const prevOpenRef = React.useRef(open)
    const [closing, setClosing] = React.useState(false)
    const [holdAnimate, setHoldAnimate] = React.useState(false)
    const justToggled = prevOpenRef.current !== open
    // Deps = `open` ONLY, and guarded on the ref, so re-renders during the hold do not re-arm it
    // (which would cancel the timer and leave the class stuck on).
    React.useEffect(() => {
        if (prevOpenRef.current === open) return
        prevOpenRef.current = open
        setHoldAnimate(true)
        if (!open) setClosing(true)
        const timer = setTimeout(() => {
            setHoldAnimate(false)
            setClosing(false)
        }, paneSlideHoldMs())
        return () => clearTimeout(timer)
    }, [open])
    return {
        animate: (justToggled || holdAnimate) && !dragging,
        // `justToggled` covers the closing frame itself — `closing` is only set in the effect, so
        // without it the pane unmounts for one frame and remounts to slide out.
        keepMounted: open || closing || justToggled,
    }
}

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
    paneGrow = false,
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
    // The gutter's live width: 0 while hidden, so every total derived from it stays honest.
    const barWidth = barHidden ? 0 : BAR_WIDTH
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
        return rect ? rect.width - barWidth : lastRef.current.total
    }, [barWidth])

    React.useEffect(() => {
        const el = rootRef.current
        if (!el || typeof ResizeObserver === "undefined") return
        const read = () => setMeasuredTotal(el.getBoundingClientRect().width - barWidth)
        read()
        const observer = new ResizeObserver(read)
        observer.observe(el)
        return () => observer.disconnect()
    }, [barWidth])

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
        const total = rect.width - barWidth
        const raw =
            paneSide === "start"
                ? e.clientX - rect.left - barWidth / 2
                : rect.right - e.clientX - barWidth / 2
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

    // The open width, remembered so a collapsed pane still knows how wide its content was.
    const lastOpenSizeRef = React.useRef(paneSize)
    if (paneSize > 0) lastOpenSizeRef.current = paneSize
    const sliding = animate && !dragging
    const slideMs = paneSlideMs()

    const paneNode = (
        <div
            data-slot="split-pane-pane"
            className={cn(
                // min-w-0: a flex item floors at min-content otherwise, so a pane whose content has
                // an intrinsic width would refuse to follow `paneSize` down. The basis is the truth.
                "relative box-border min-h-0 min-w-0 shrink-0 overflow-hidden",
                paneGrow ? "grow" : "grow-0",
                paneClassName,
            )}
            style={{
                flexBasis: paneSize,
                // Inline, not a class: the duration is dynamic, and inline also beats any
                // `transition` a host set through `paneClassName`.
                transition: sliding ? `flex-basis ${slideMs}ms ${PANE_SLIDE_CURVE}` : undefined,
            }}
        >
            {/* During the slide the content is TAKEN OUT OF FLOW at a FIXED pixel width and pinned
                to the edge the pane collapses towards, so the shrinking box translates it out of
                view and clips it. Nothing inside ever sees an intermediate width: without this the
                content re-lays-out on every frame — tiles reflow into fewer columns, labels rewrap,
                the column grows taller than the pane — which is far uglier than the motion it was
                meant to be part of. Static + `w-full` again once the slide ends, so a DRAG still
                reflows the content live (there the reflow IS the feedback).
                Start-side pins right / end-side pins left: the anchored edge is the one the box's
                own edge is moving along, which is what turns a width change into a translation. */}
            <div
                data-slot="split-pane-pane-content"
                className={cn("h-full min-h-0", sliding && "absolute inset-y-0")}
                style={
                    sliding
                        ? {
                              width: lastOpenSizeRef.current,
                              ...(paneSide === "start" ? {right: 0} : {left: 0}),
                          }
                        : {width: "100%"}
                }
            >
                {pane}
            </div>
        </div>
    )

    // Hidden = zero-width, NOT unmounted. Removing the 9px column outright made the fill jump that
    // much in the frame the collapse started, so the pane's own 240ms slide began from an already-
    // shifted layout and read as a snap-then-glide. At basis 0 the gutter closes on the same curve
    // as the pane, and the whole collapse is one motion. It also drops out of the tab order and the
    // a11y tree while closed, which `display:none` would have done for free and `width:0` must not
    // forget.
    const barNode = (
        <div
            data-slot="split-pane-bar"
            role={barHidden ? undefined : "separator"}
            aria-orientation={barHidden ? undefined : "vertical"}
            aria-hidden={barHidden || undefined}
            aria-label={resizable && !barHidden ? barLabel : undefined}
            {...(barHidden ? {} : ariaValues)}
            tabIndex={resizable && !barHidden ? 0 : undefined}
            onPointerDown={barHidden ? undefined : handlePointerDown}
            onPointerMove={barHidden ? undefined : handlePointerMove}
            onPointerUp={barHidden ? undefined : handlePointerFinish}
            onPointerCancel={barHidden ? undefined : handlePointerFinish}
            onKeyDown={barHidden ? undefined : handleKeyDown}
            className={cn(
                // `overflow-visible`: the hairline, the grip and the hit-slop all paint OUTSIDE
                // the zero-width bar box, centred on the seam.
                "group relative z-[5] box-border h-full shrink-0 touch-none select-none overflow-visible",
                resizable &&
                    !barHidden &&
                    "cursor-col-resize outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring",
                barClassName,
            )}
            style={{
                flexBasis: barHidden ? 0 : BAR_WIDTH,
                width: barHidden ? 0 : BAR_WIDTH,
                // `height` rides along for hosts that resize the bar (the chat's bar clears the
                // absolute session strip); `flex-basis` never changes during a drag, so leaving
                // both on unconditionally costs nothing.
                transition: `flex-basis ${slideMs}ms ${PANE_SLIDE_CURVE}, height ${slideMs}ms ${PANE_SLIDE_CURVE}`,
            }}
        >
            {/* Centre hairline — strengthens to the border tone on hover/drag. A hidden bar
                paints nothing: the box no longer clips, so this has to be gated explicitly. */}
            {barHidden ? null : (
                <span
                    aria-hidden
                    className={cn(
                        "absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-colorBorderSecondary transition-colors duration-150",
                        resizable && "group-hover:bg-colorBorder",
                        dragging && "bg-colorBorder",
                    )}
                />
            )}
            {/* Grip pill — quiet at rest, a longer primary tint under the pointer. */}
            {resizable && !barHidden ? (
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
            {/* Hit-slop: the visible pixels are 2-4px wide, so the grab target is a wider
                invisible overlay centred on the seam (antd's dragger was 12px). Its pointer
                events bubble to the bar's own handlers. */}
            {resizable && !barHidden ? (
                <span
                    aria-hidden
                    className="absolute inset-y-0 left-1/2 -translate-x-1/2 cursor-col-resize"
                    style={{width: BAR_HIT_WIDTH}}
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
