import {useMemo} from "react"

import clsx from "clsx"

export interface HeightCollapseProps {
    open: boolean
    children: React.ReactNode
    className?: string
    contentClassName?: string
    durationMs?: number
    animate?: boolean
    collapsedHeight?: number
    /**
     * Also fade opacity 0↔1 with the height. Use for docked chrome/notices where content appearing
     * sharply as the box unfolds looks abrupt; omit to keep the plain height-only collapse used by
     * the tool gutter, accordion sections, etc. Default false.
     */
    fade?: boolean
    /**
     * Also translate the content on the Y axis: it sits `slideY`px below its resting place while
     * closed and eases to 0 on open (and back on close) — a subtle slide for bottom-docked notices.
     * Pair with `fade` so the collapsing frames read cleanly. Default 0 (no translate).
     */
    slideY?: number
    /**
     * Apply the `inert` attribute while FULLY closed, dropping the hidden subtree from tab order +
     * a11y (e.g. an approval dock's buttons must not be reachable when collapsed). Opt-in so a
     * `collapsedHeight > 0` peek keeps its still-visible content interactive. Default false.
     */
    inert?: boolean
}

/**
 * HeightCollapse
 *
 * CSS-native collapse that transitions `height` between pixel values and `auto` using
 * `interpolate-size: allow-keywords`. Plain CSS transitions (NOT `motion-safe`-gated), so it
 * animates regardless of the OS reduced-motion setting. The single collapse primitive for chrome
 * that enters/leaves a column — accordion sections, the tool gutter, and (via `fade`/`slideY`) the
 * composer dock, queued messages, and the config-pane notices — so everything moves the same way.
 */
export function HeightCollapse({
    open,
    children,
    className,
    contentClassName,
    durationMs = 300,
    animate = true,
    collapsedHeight = 0,
    fade = false,
    slideY = 0,
    inert = false,
}: HeightCollapseProps) {
    const collapsedHeightPx = useMemo(() => `${Math.max(0, collapsedHeight)}px`, [collapsedHeight])

    const easing = "cubic-bezier(0.4, 0, 0.2, 1)"

    const outerStyle = useMemo(
        () =>
            ({
                height: open ? "auto" : collapsedHeightPx,
                opacity: fade ? (open ? 1 : 0) : undefined,
                interpolateSize: "allow-keywords",
                transitionProperty: animate ? (fade ? "height, opacity" : "height") : "none",
                transitionDuration: animate ? `${durationMs}ms` : "0ms",
                transitionTimingFunction: animate ? easing : "linear",
            }) as React.CSSProperties,
        [open, collapsedHeightPx, animate, fade, durationMs],
    )

    const innerStyle = useMemo<React.CSSProperties | undefined>(
        () =>
            slideY
                ? {
                      transform: open ? "translateY(0)" : `translateY(${slideY}px)`,
                      transitionProperty: animate ? "transform" : "none",
                      transitionDuration: animate ? `${durationMs}ms` : "0ms",
                      transitionTimingFunction: animate ? easing : "linear",
                  }
                : undefined,
        [slideY, open, animate, durationMs],
    )

    // `inert` only while fully collapsed — a peek (collapsedHeight > 0) stays interactive.
    const isInert = inert && !open && collapsedHeight === 0

    return (
        <div
            className={clsx("overflow-hidden", className)}
            style={outerStyle}
            aria-hidden={!open}
            inert={isInert}
        >
            <div className={contentClassName} style={innerStyle}>
                {children}
            </div>
        </div>
    )
}

export default HeightCollapse
