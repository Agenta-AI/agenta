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
}

/**
 * HeightCollapse
 *
 * CSS-native collapse that transitions `height` between pixel values and `auto`
 * using `interpolate-size: allow-keywords`.
 */
export function HeightCollapse({
    open,
    children,
    className,
    contentClassName,
    durationMs = 300,
    animate = true,
    collapsedHeight = 0,
}: HeightCollapseProps) {
    const collapsedHeightPx = useMemo(() => `${Math.max(0, collapsedHeight)}px`, [collapsedHeight])

    const style = useMemo(
        () =>
            ({
                height: open ? "auto" : collapsedHeightPx,
                interpolateSize: "allow-keywords",
                transitionProperty: animate ? "height" : "none",
                transitionDuration: animate ? `${durationMs}ms` : "0ms",
                transitionTimingFunction: animate ? "cubic-bezier(0.4, 0, 0.2, 1)" : "linear",
            }) as React.CSSProperties,
        [open, collapsedHeightPx, animate, durationMs],
    )

    return (
        <div className={clsx("overflow-hidden", className)} style={style} aria-hidden={!open}>
            <div className={contentClassName}>{children}</div>
        </div>
    )
}

export default HeightCollapse
