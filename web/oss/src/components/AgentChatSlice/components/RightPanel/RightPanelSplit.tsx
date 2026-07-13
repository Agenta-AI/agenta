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
// The fill (chat) pane is forced to `flex:1 1 auto` PERMANENTLY (not just during the slide): it
// then tracks the container/driven sibling purely via flexbox, ignoring antd's per-frame inline
// flex-basis. Keeping it permanent removes the end-of-slide SWITCH — when this rule was gated to
// the animation window, dropping it handed the chat back to antd's ResizeObserver basis, which had
// lagged behind during a heavy slide, so the pane SNAPPED to catch up right as the transition
// ended (an empty session was smooth only because antd kept up). No transition on it, so it never
// lags the way a transitioned basis would.
const FILL_PANE_CLASS =
    "[&>.ant-splitter-panel:first-child]:!flex-auto [&>.ant-splitter-panel:first-child]:!transition-none"
// Only the DRIVEN pane (the panel, last) transitions its flex-basis, and ONLY around a flip.
// antd v6 sizes panels via inline `flexBasis`/`flexGrow` (Panel.js), so basis is the property to
// transition. Curve kept IDENTICAL to globals.css .playground-splitter-animated so the nested
// inner/outer slides read as one motion.
const DRIVEN_SLIDE_CLASS =
    "[&>.ant-splitter-panel:last-child]:[transition:flex-basis_240ms_cubic-bezier(0.4,0,0.2,1)]"

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
    // The "from" basis is painted for one frame (with the slide class on) before the size flips
    // to its target, so flex-basis has a prior value to transition FROM instead of popping. antd
    // writes the panel basis inline, so without this pre-frame the browser first paints the NEW
    // basis (class not yet applied) and the later class arrival has nothing left to animate.
    const [preFrame, setPreFrame] = useState(false)
    const justToggled = prevOpen !== open
    if (justToggled) {
        setPrevOpen(open)
        setPreFrame(true)
        if (!open) setClosing(true)
    }
    useEffect(() => {
        if (!closing) return
        const timer = setTimeout(() => setClosing(false), SLIDE_MS + 40)
        return () => clearTimeout(timer)
    }, [closing])
    // Clear the pre-frame after exactly ONE painted frame (the preFrame render already carries the
    // slide class — `preFrame` is in `animate` below — so the from-basis frame is class-on when it
    // paints). A single rAF flips to the target basis on the next frame, so the transition fires off
    // a painted prior value. One frame (not two): on CLOSE the from-basis is `live`, so a 2-frame
    // hold reads as a visible hitch before the slide; one frame is imperceptible.
    useEffect(() => {
        if (!preFrame) return
        const r = requestAnimationFrame(() => setPreFrame(false))
        return () => cancelAnimationFrame(r)
    }, [preFrame])
    // Animate ONLY around a flip (MainLayout's animateSplit pattern): antd recomputes every
    // panel's inline flex-basis from a ResizeObserver, so a PERMANENT transition makes the chat
    // panel lag 240ms behind each tick while the outer playground pane eases or the window
    // resizes — the transcript rubber-bands against its own container.
    useEffect(() => {
        setHoldAnimate(true)
        const timer = setTimeout(() => setHoldAnimate(false), SLIDE_MS + 40)
        return () => clearTimeout(timer)
    }, [open])
    const animate = (justToggled || holdAnimate || preFrame) && !dragging

    // Re-sync to the stored width each time the panel opens.
    useEffect(() => {
        if (open) setLive(persisted)
    }, [open])

    // Panel basis: hold the FROM value during the pre-frame (opening → 0, closing → live), then
    // settle to the target (open → live, closed → 0) so the slide runs off a painted prior value.
    const panelSize = preFrame ? (open ? 0 : live) : open ? live : 0
    // Suppress the min clamp on the collapsed frames so the 0-basis "from"/"to" isn't snapped up
    // to RIGHT_PANEL_MIN by antd (which would erase the slide).
    const panelMin = open && !preFrame ? `${RIGHT_PANEL_MIN}px` : 0

    return (
        <Splitter
            className={`h-full min-h-0 w-full flex-1 ${FILL_PANE_CLASS} ${animate ? DRIVEN_SLIDE_CLASS : ""}`}
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
                size={panelSize}
                min={panelMin}
                max={`${RIGHT_PANEL_MAX}px`}
                resizable={open && !preFrame}
            >
                {open || closing ? panel : null}
            </Splitter.Panel>
        </Splitter>
    )
}

export default RightPanelSplit
