import {useMemo} from "react"

import clsx from "clsx"
import {useReducedMotion} from "motion/react"

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
    /** @deprecated No-op — a fully-closed body is always `inert` now (it is also `aria-hidden`). */
    inert?: boolean
}

/**
 * HeightCollapse
 *
 * CSS-native collapse that transitions `height` between pixel values and `auto` using
 * `interpolate-size: allow-keywords`. It moves on the theme's `duration-base` and `ease-in-out`
 * unless a caller passes `durationMs`; under reduced motion the new state shows at once (MOTION-02).
 * The single collapse primitive for chrome
 * that enters/leaves a column — accordion sections, the tool gutter, and (via `fade`/`slideY`) the
 * composer dock, queued messages, and the config-pane notices — so everything moves the same way.
 */
export function HeightCollapse({
    open,
    children,
    className,
    contentClassName,
    durationMs,
    animate: animateProp = true,
    collapsedHeight = 0,
    fade = false,
    slideY = 0,
    inert = false,
}: HeightCollapseProps) {
    const collapsedHeightPx = useMemo(() => `${Math.max(0, collapsedHeight)}px`, [collapsedHeight])

    const reducedMotion = useReducedMotion()
    const animate = animateProp && !reducedMotion
    const easing = "var(--ease-in-out, cubic-bezier(0.4, 0, 0.2, 1))"
    const duration = durationMs === undefined ? "var(--duration-base, 200ms)" : `${durationMs}ms`

    const outerStyle = useMemo(
        () =>
            ({
                height: open ? "auto" : collapsedHeightPx,
                opacity: fade ? (open ? 1 : 0) : undefined,
                interpolateSize: "allow-keywords",
                transitionProperty: animate ? (fade ? "height, opacity" : "height") : "none",
                transitionDuration: animate ? duration : "0ms",
                transitionTimingFunction: animate ? easing : "linear",
            }) as React.CSSProperties,
        [open, collapsedHeightPx, animate, fade, duration, easing],
    )

    const innerStyle = useMemo<React.CSSProperties | undefined>(
        () =>
            slideY
                ? {
                      transform: open ? "translateY(0)" : `translateY(${slideY}px)`,
                      transitionProperty: animate ? "transform" : "none",
                      transitionDuration: animate ? duration : "0ms",
                      transitionTimingFunction: animate ? easing : "linear",
                  }
                : undefined,
        [slideY, open, animate, duration, easing],
    )

    // aria-hidden and inert move together — hiding a still-tabbable subtree is aria-hidden-focus.
    // A peek (collapsedHeight > 0) is visible, so it is neither. `inert` prop is now a no-op.
    void inert
    const isCollapsedShut = !open && collapsedHeight === 0

    return (
        <div
            className={clsx("overflow-hidden", className)}
            style={outerStyle}
            aria-hidden={isCollapsedShut}
            inert={isCollapsedShut}
        >
            <div className={contentClassName} style={innerStyle}>
                {children}
            </div>
        </div>
    )
}

export default HeightCollapse
