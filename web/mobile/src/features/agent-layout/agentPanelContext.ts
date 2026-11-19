import {createContext, useContext} from "react"

import type {ConfigTab, PanelContent} from "./agentPanelState"

/** What a panel content and its view chrome may ask of the panel host. */
export interface AgentPanelApi {
    content: PanelContent | null
    /** A header icon: the open content's icon closes the panel; another icon swaps it. Guarded. */
    toggle: (content: PanelContent) => Promise<boolean>
    /** Close the panel. Guarded by the leave guard. */
    close: () => Promise<boolean>
    configTab: ConfigTab
    setConfigTab: (tab: ConfigTab) => void
    /** A wide view grows the panel to 760 px while it is open; never stored. */
    wide: boolean
    setWide: (wide: boolean) => void
    /** Below 768 px a content opens full screen with a back arrow. */
    phone: boolean
}

export const AgentPanelContext = createContext<AgentPanelApi | null>(null)

export const useAgentPanel = (): AgentPanelApi => {
    const panel = useContext(AgentPanelContext)
    if (!panel) throw new Error("useAgentPanel must be used inside the agent layout")
    return panel
}
