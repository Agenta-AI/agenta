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

/**
 * Nested resizable split: [chat | right panel]. The Splitter (and thus the chat column) stays
 * mounted across open/close — the panel just collapses to width 0 — so the transcript never
 * remounts. Drag width is held in local state for smoothness and persisted only on drag-end (no
 * per-frame localStorage writes). The chat keeps a hard min so the panel can't squeeze it.
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

    // Re-sync to the stored width each time the panel opens.
    useEffect(() => {
        if (open) setLive(persisted)
    }, [open])

    return (
        <Splitter
            className="h-full min-h-0 w-full flex-1"
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
                resizable={open}
            >
                {panel}
            </Splitter.Panel>
        </Splitter>
    )
}

export default RightPanelSplit
