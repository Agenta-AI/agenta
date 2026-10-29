import {useEffect, useState} from "react"

import {CHAT_COLUMN} from "@agenta/chat/assets"

/**
 * One message row. Carries `data-mid` (load-bearing for the pin / anchor / ResizeObserver, which all
 * query it). A message added after mount (`enter`) fades in — OPACITY ONLY, deliberately: opacity
 * doesn't change geometry, so it can't move the scroll position or trip the SC-3 ResizeObserver. A
 * restored thread's messages render with `enter=false` (no cascade). Honors reduced-motion: the
 * initial transparency and the transition are both `motion-safe`, so it's instant-visible otherwise.
 */
const MessageRow = ({
    mid,
    enter,
    children,
    inspected = false,
    onInspect,
    offscreenSkip = false,
}: {
    mid: string
    enter: boolean
    children: React.ReactNode
    /** This turn is the Turn Inspector's current target — tint it. */
    inspected?: boolean
    /** Set (assistant turns, inspector open) → click the row to re-focus the inspector on it. */
    onInspect?: () => void
    /** Settled row → `content-visibility:auto` so the browser skips its layout/paint while off-screen.
     * `contain-intrinsic-size: auto` remembers the real height after first paint, so leaving the
     * viewport causes no layout shift (heights here range ~85–1022px; no fixed estimate works). */
    offscreenSkip?: boolean
}) => {
    const [shown, setShown] = useState(!enter)
    // Reveal one frame after mount so the opacity transition plays. Deps are [] (NOT
    // [enter]) on purpose: an `enter` flip when a sibling turn arrives must not cancel
    // this rAF, or a just-sent message strands at opacity-0 for the whole agent run.
    useEffect(() => {
        const raf = requestAnimationFrame(() => setShown(true))
        return () => cancelAnimationFrame(raf)
    }, [])
    // Click-to-refocus: only while the inspector is open, and never over an interactive control or
    // an active text selection (so buttons, links, and copy-select still work).
    const handleClick = onInspect
        ? (e: React.MouseEvent) => {
              if ((e.target as HTMLElement).closest("button, a, input, textarea, [role='button']"))
                  return
              if (!window.getSelection()?.isCollapsed) return
              onInspect()
          }
        : undefined
    // While the inspector is open, every turn is interactive: padded + rounded so the fill has
    // breathing room, and cursor-pointer everywhere (clicking the selected turn just re-selects it).
    // Hover is a light fill; the SELECTED turn is a held fill + a left accent bar, so "the one the
    // inspector is showing" reads distinctly from a passing hover. Background + accent-bar both
    // transition, so selection glides between turns instead of snapping. `box-border` is required
    // (preflight off → content-box) so the padding doesn't overflow the 880px column.
    const interactive = Boolean(onInspect)
    // `shown || !enter` is a belt-and-suspenders: a settled row (id seen) is always visible.
    return (
        <div
            data-mid={mid}
            onClick={handleClick}
            className={`${CHAT_COLUMN} flex flex-col gap-1 motion-safe:transition-[opacity,background-color,box-shadow] motion-safe:duration-200 motion-safe:ease-out ${
                offscreenSkip ? "[content-visibility:auto] [contain-intrinsic-size:auto_240px]" : ""
            } ${shown || !enter ? "opacity-100" : "motion-safe:opacity-0"} ${
                interactive ? "box-border cursor-pointer rounded-lg px-3 py-2.5" : ""
            } ${
                inspected
                    ? "bg-[var(--ag-colorFillSecondary)] shadow-[inset_2px_0_0_var(--ag-colorPrimary)]"
                    : interactive
                      ? "hover:bg-[var(--ag-colorFillTertiary)]"
                      : ""
            }`}
        >
            {children}
        </div>
    )
}

export default MessageRow
