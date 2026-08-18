import {useEffect, useState, type ReactNode} from "react"

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

    // Flip detection during render so the animate flag lands in the same commit as the size flip.
    const [prevOpen, setPrevOpen] = useState(open)
    const [closing, setClosing] = useState(false)
    const [holdAnimate, setHoldAnimate] = useState(false)
    const justToggled = prevOpen !== open
    if (justToggled) {
        setPrevOpen(open)
        if (!open) setClosing(true)
    }
    // On close the panel content stays mounted until the collapse finishes, so it slides out
    // instead of blanking to an empty sliver.
    useEffect(() => {
        if (!closing) return
        const timer = setTimeout(() => setClosing(false), SLIDE_MS + 40)
        return () => clearTimeout(timer)
    }, [closing])
    // Animate ONLY around a flip: a permanent basis transition would lag pointer drags.
    useEffect(() => {
        setHoldAnimate(true)
        const timer = setTimeout(() => setHoldAnimate(false), SLIDE_MS + 40)
        return () => clearTimeout(timer)
    }, [open])
    const animate = (justToggled || holdAnimate) && !dragging

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
            className="h-full min-h-0 w-full flex-1"
            // The divider spans the pane height minus the absolute session bar's inset, so it
            // starts below the bar; transitioned on the build↔chat flip to move with the panes.
            barClassName="h-[calc(100%-var(--agent-bar-inset,0px))] self-end [transition:height_240ms_cubic-bezier(0.4,0,0.2,1)]"
            onResizeStart={() => setDragging(true)}
            onResize={(size, total) => {
                if (open) setLive(clampWidth(size, total, min, max))
            }}
            onResizeEnd={(size, total) => {
                setDragging(false)
                if (open) setPersisted(clampWidth(size, total, min, max))
            }}
            pane={open || closing ? panel : null}
            fill={children}
        />
    )
}

export default RightPanelSplit
