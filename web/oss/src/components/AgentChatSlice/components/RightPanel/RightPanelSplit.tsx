import {useEffect, useRef, useState, type ReactNode} from "react"

import {SplitPane} from "@agenta/ui/ui"
import {useAtom, type WritableAtom} from "jotai"

import {
    CHAT_MIN,
    RIGHT_PANEL_MAX,
    RIGHT_PANEL_MIN,
    rightPanelWidthAtom,
} from "../../state/rightPanel"

/** Clamp the panel width to [min, max] AND never let the chat fall below its floor. */
const clampWidth = (w: number, total: number, min: number, max: number) =>
    Math.max(min, Math.min(w, max, Math.max(min, total - CHAT_MIN)))

// Open/close slide duration — matches SplitPane's flex-basis transition (240ms, the
// playground curve), so the closing content hold below releases right as the slide ends.
const SLIDE_MS = 240

/**
 * Nested resizable split: [chat | right panel]. The split (and thus the chat column) stays
 * mounted across open/close — the panel just collapses to width 0 — so the transcript never
 * remounts. Drag width is held in local state for smoothness and persisted only on drag-end (no
 * per-frame localStorage writes). The chat keeps a hard min so the panel can't squeeze it.
 *
 * SplitPane's driven basis is fully controlled, so the open/close slide is just its `animate`
 * transition around a flip — none of the pre-frame machinery the antd Splitter version needed
 * (antd rewrote inline flex-basis from a ResizeObserver, which fought any CSS transition).
 */
const RightPanelSplit = ({
    open,
    panel,
    children,
    widthAtom = rightPanelWidthAtom,
    min = RIGHT_PANEL_MIN,
    max = RIGHT_PANEL_MAX,
}: {
    open: boolean
    panel: ReactNode
    children: ReactNode
    /** Persisted width store + clamp bounds — defaults are the Inspector's; the Files pane passes
     * its own so the two right-edge panes keep independent widths. */
    widthAtom?: WritableAtom<number, [number], void>
    min?: number
    max?: number
}) => {
    const [persisted, setPersisted] = useAtom(widthAtom)
    const [live, setLive] = useState(persisted)
    const [dragging, setDragging] = useState(false)

    // Flip detection during render so the animate flag lands in the SAME commit as the size flip.
    // It has to be a REF, not state: a render-phase `setPrevOpen` makes React re-render before it
    // commits, and the re-render sees prevOpen === open — so `justToggled` was always false in the
    // committed output, `holdAnimate` only arrived in an effect (after the new width was painted),
    // and the panel snapped open and shut. A ref survives into the commit. Same shape MainLayout
    // uses for the config pane.
    const prevOpenRef = useRef(open)
    const [closing, setClosing] = useState(false)
    const [holdAnimate, setHoldAnimate] = useState(false)
    const justToggled = prevOpenRef.current !== open
    // One effect per flip: hold the transition class ~SLIDE_MS so removing it doesn't snap, and
    // keep the panel's content mounted for the same window so it slides out instead of blanking to
    // an empty sliver. Deps = `open` ONLY, and guarded on the ref, so mount and re-renders during
    // the hold don't re-arm (which would cancel the timer and leave the class stuck on).
    useEffect(() => {
        if (prevOpenRef.current === open) return
        prevOpenRef.current = open
        setHoldAnimate(true)
        if (!open) setClosing(true)
        const timer = setTimeout(() => {
            setHoldAnimate(false)
            setClosing(false)
        }, SLIDE_MS + 40)
        return () => clearTimeout(timer)
    }, [open])
    const animate = (justToggled || holdAnimate) && !dragging
    // `justToggled` covers the closing frame itself — `closing` is only set in the effect above, so
    // without it the panel would unmount for one frame and remount to slide out.
    const keepPanelMounted = open || closing || justToggled

    // Re-sync to the stored width each time the panel opens.
    useEffect(() => {
        if (open) setLive(persisted)
    }, [open])

    return (
        <SplitPane
            paneSide="end"
            paneSize={open ? live : 0}
            paneMin={open ? min : 0}
            paneMax={max}
            fillMin={CHAT_MIN}
            resizable={open}
            animate={animate}
            // A closed panel draws no divider. These splits NEST (Inspector inside the Files
            // split's chat column), so two closed ones painted 18px of stacked empty gutter at the
            // right edge; a single closed one reads as a double border beside an open one. Zero-
            // width rather than unmounted, so it closes on the same curve as the panel.
            barHidden={!open}
            className="h-full min-h-0 w-full flex-1"
            // The divider spans the pane height minus the absolute session bar's inset, so it
            // starts below the bar; transitioned on the build↔chat flip to move with the panes.
            // `flex-basis` is listed HERE too: this class lands after SplitPane's own slide in the
            // merge, so a height-only declaration would silently drop the bar's open/close slide.
            barClassName="h-[calc(100%-var(--agent-bar-inset,0px))] self-end [transition:height_240ms_cubic-bezier(0.4,0,0.2,1),flex-basis_240ms_cubic-bezier(0.4,0,0.2,1)]"
            onResizeStart={() => setDragging(true)}
            onResize={(size, total) => {
                if (open) setLive(clampWidth(size, total, min, max))
            }}
            onResizeEnd={(size, total) => {
                setDragging(false)
                if (open) setPersisted(clampWidth(size, total, min, max))
            }}
            pane={keepPanelMounted ? panel : null}
            fill={children}
        />
    )
}

export default RightPanelSplit
