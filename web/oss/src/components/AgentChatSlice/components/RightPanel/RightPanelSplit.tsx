import {useEffect, useState, type ReactNode} from "react"

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

// Open/close slide duration. The class must be a static string (Tailwind JIT can't see
// interpolated names), so the 240ms is duplicated there
// (curve = the playground pane ease, globals.css .playground-splitter-animated). The transition lives on the panes
// whenever the divider is NOT being dragged — putting it behind an effect-driven flag doesn't
// work: effects run after the size change is committed, so the class would arrive after the
// browser already painted the new width and nothing would animate.
const SLIDE_MS = 240
const SLIDE_CLASS =
    "[&_.ant-splitter-panel]:[transition:flex-basis_240ms_cubic-bezier(0.4,0,0.2,1),width_240ms_cubic-bezier(0.4,0,0.2,1)]"

/**
 * Nested resizable split: [chat | right panel]. The Splitter (and thus the chat column) stays
 * mounted across open/close — the panel just collapses to width 0 — so the transcript never
 * remounts. Drag width is held in local state for smoothness and persisted only on drag-end (no
 * per-frame localStorage writes). The chat keeps a hard min so the panel can't squeeze it.
 *
 * Open/close slides: the panes carry a width transition (suspended during divider drags so
 * resizing tracks the pointer 1:1), and on close the panel content stays mounted until the
 * collapse finishes so it slides out instead of blanking.
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
    const [dragging, setDragging] = useState(false)

    // Flip detection DURING render (not in an effect) so the transition class and the content
    // hold land in the very commit that changes the size — an effect would arrive a paint late.
    const [prevOpen, setPrevOpen] = useState(open)
    const [closing, setClosing] = useState(false)
    const [holdAnimate, setHoldAnimate] = useState(false)
    const justToggled = prevOpen !== open
    if (justToggled) {
        setPrevOpen(open)
        if (!open) setClosing(true)
    }
    useEffect(() => {
        if (!closing) return
        const timer = setTimeout(() => setClosing(false), SLIDE_MS + 40)
        return () => clearTimeout(timer)
    }, [closing])
    // Animate ONLY around a flip (MainLayout's animateSplit pattern): antd recomputes every
    // panel's inline flex-basis from a ResizeObserver, so a PERMANENT transition makes the chat
    // panel lag 240ms behind each tick while the outer playground pane eases or the window
    // resizes — the transcript rubber-bands against its own container.
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
        <Splitter
            className={`h-full min-h-0 w-full flex-1 ${animate ? SLIDE_CLASS : ""}`}
            onResizeStart={() => setDragging(true)}
            onResize={(sizes) => {
                if (open) setLive(clampWidth(sizes[1], sizes[0] + sizes[1]))
            }}
            onResizeEnd={(sizes) => {
                setDragging(false)
                if (open) setPersisted(clampWidth(sizes[1], sizes[0] + sizes[1]))
            }}
        >
            <Splitter.Panel min={`${CHAT_MIN}px`}>{children}</Splitter.Panel>
            <Splitter.Panel
                size={open ? live : 0}
                min={open ? `${RIGHT_PANEL_MIN}px` : 0}
                max={`${RIGHT_PANEL_MAX}px`}
                resizable={open}
            >
                {open || closing ? panel : null}
            </Splitter.Panel>
        </Splitter>
    )
}

export default RightPanelSplit
