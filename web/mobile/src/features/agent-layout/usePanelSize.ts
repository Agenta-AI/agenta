import {useState} from "react"

import {useMediaQuery} from "@agenta/ui/hooks"

import type {PanelMode, PanelResize} from "./AgentPanelFrame"
import {OVERLAY_BELOW, PANEL_MAX, PANEL_MIN, PANEL_WIDE} from "./agentPanelState"

/**
 * The one size setting of the right panel, for every content (Files, Configuration, Builder) and
 * both hosts (the session screen, the agent pages): the stored width, the drag between PANEL_MIN
 * and PANEL_MAX, and the 760 px widen, which lies over the page. Under 1100 px the panel lies
 * over the page; on a phone it covers it.
 */
export const usePanelSize = ({
    phone,
    storedWidth,
    storeWidth,
}: {
    phone: boolean
    storedWidth: number
    storeWidth: (width: number) => void
}) => {
    const pushWidth = useMediaQuery(`(min-width: ${OVERLAY_BELOW}px)`)
    const [wide, setWide] = useState(false)
    // The width while a drag runs; null shows the stored width.
    const [liveWidth, setLiveWidth] = useState<number | null>(null)
    const mode: PanelMode = phone ? "full" : !pushWidth || wide ? "overlay" : "push"
    const resize: PanelResize | null =
        mode === "full" || wide
            ? null
            : {
                  min: PANEL_MIN,
                  max: PANEL_MAX,
                  onLive: setLiveWidth,
                  onCommit: (width) => {
                      setLiveWidth(null)
                      storeWidth(width)
                  },
              }
    return {
        pushWidth,
        mode,
        width: wide ? PANEL_WIDE : (liveWidth ?? storedWidth),
        resize,
        wide,
        setWide,
    }
}
