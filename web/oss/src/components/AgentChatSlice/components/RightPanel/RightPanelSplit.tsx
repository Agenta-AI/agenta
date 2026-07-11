import {useEffect, useRef, useState, type ReactNode} from "react"

import {Splitter} from "antd"
import {useAtom} from "jotai"

import {
    CHAT_MIN,
    RIGHT_PANEL_MAX,
    RIGHT_PANEL_MIN,
    rightPanelWidthAtom,
} from "../../state/rightPanel"

/** Clamp the panel width to [min, max] AND never let the chat fall below its floor. */
const clampWidth = (w: number, total: number) =>
    Math.max(
        RIGHT_PANEL_MIN,
        Math.min(w, RIGHT_PANEL_MAX, Math.max(RIGHT_PANEL_MIN, total - CHAT_MIN)),
    )

// Open/close slide duration. The transition is enabled ONLY for this window around an `open`
// flip — a persistent transition would rubber-band the divider while dragging. The class must be
// a static string (Tailwind JIT can't see interpolated names), so the 220ms is duplicated there.
const SLIDE_MS = 220
const SLIDE_CLASS = "[&_.ant-splitter-panel]:[transition:flex-basis_220ms_ease,width_220ms_ease]"

/**
 * Nested resizable split: [chat | right panel]. The Splitter (and thus the chat column) stays
 * mounted across open/close — the panel just collapses to width 0 — so the transcript never
 * remounts. Drag width is held in local state for smoothness and persisted only on drag-end (no
 * per-frame localStorage writes). The chat keeps a hard min so the panel can't squeeze it.
 *
 * Open/close is animated: the panels get a width transition for the flip window, and the panel
 * content stays mounted until the collapse finishes so it slides out instead of vanishing.
 */
const RightPanelSplit = ({
    open,
    panel,
    children,
}: {
    open: boolean
    panel: ReactNode
    children: ReactNode
}) => {
    const [persisted, setPersisted] = useAtom(rightPanelWidthAtom)
    const [live, setLive] = useState(persisted)

    // Transition window + delayed unmount around `open` flips (skips first render). `holdContent`
    // only matters while closing — opening renders the content immediately via `open` itself.
    const prevOpen = useRef(open)
    const [animating, setAnimating] = useState(false)
    const [holdContent, setHoldContent] = useState(false)
    useEffect(() => {
        if (prevOpen.current === open) return
        prevOpen.current = open
        setAnimating(true)
        if (!open) setHoldContent(true)
        const timer = setTimeout(() => {
            setAnimating(false)
            setHoldContent(false)
        }, SLIDE_MS + 40)
        return () => clearTimeout(timer)
    }, [open])

    // Re-sync to the stored width each time the panel opens.
    useEffect(() => {
        if (open) setLive(persisted)
    }, [open])

    return (
        <Splitter
            className={`h-full min-h-0 w-full flex-1 ${animating ? SLIDE_CLASS : ""}`}
            onResize={(sizes) => {
                if (open) setLive(clampWidth(sizes[1], sizes[0] + sizes[1]))
            }}
            onResizeEnd={(sizes) => {
                if (open) setPersisted(clampWidth(sizes[1], sizes[0] + sizes[1]))
            }}
        >
            <Splitter.Panel min={`${CHAT_MIN}px`}>{children}</Splitter.Panel>
            <Splitter.Panel
                size={open ? live : 0}
                min={open ? `${RIGHT_PANEL_MIN}px` : 0}
                max={`${RIGHT_PANEL_MAX}px`}
                resizable={open && !animating}
            >
                {open || holdContent ? panel : null}
            </Splitter.Panel>
        </Splitter>
    )
}

export default RightPanelSplit
