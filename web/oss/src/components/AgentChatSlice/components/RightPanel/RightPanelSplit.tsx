import {useEffect, useState, type ReactNode} from "react"

import {SplitPane, usePaneSlide} from "@agenta/ui/ui"
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

    // The slide itself is the shared hook — the ref-not-state flip detection, the hold, and
    // keeping the pane mounted through a close all have to line up or the panel snaps.
    const {animate, keepMounted} = usePaneSlide(open, dragging)

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
            // starts below the bar. SplitPane owns the transition (height AND flex-basis, one
            // duration) — declaring one here silently dropped the other.
            barClassName="h-[calc(100%-var(--agent-bar-inset,0px))] self-end"
            onResizeStart={() => setDragging(true)}
            onResize={(size, total) => {
                if (open) setLive(clampWidth(size, total, min, max))
            }}
            onResizeEnd={(size, total) => {
                setDragging(false)
                if (open) setPersisted(clampWidth(size, total, min, max))
            }}
            pane={keepMounted ? panel : null}
            fill={children}
        />
    )
}

export default RightPanelSplit
