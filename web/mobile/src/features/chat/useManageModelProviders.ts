import {useCallback, useContext, useState} from "react"

import {AgentPanelContext} from "../agent-layout/agentPanelContext"

import {useIsBuilderChat} from "./builderChat"
import {useOpenModelSetup} from "./useOpenModelSetup"

/**
 * "Manage model providers" under the composer's model list, and Set up on the model banner: the
 * pane's Model view where this chat's agent has a Configuration pane, else the providers drawer.
 * Only the pane reads the Model request, so nothing is left set where no pane takes it.
 */
export const useManageModelProviders = () => {
    const builderChat = useIsBuilderChat()
    const panel = useContext(AgentPanelContext)
    const openModelSetup = useOpenModelSetup()
    const paneTakesModel = !builderChat && Boolean(panel?.available.configuration)
    const [drawerOpen, setDrawerOpen] = useState(false)
    const open = useCallback(() => {
        if (paneTakesModel) openModelSetup()
        else setDrawerOpen(true)
    }, [openModelSetup, paneTakesModel])
    const closeDrawer = useCallback(() => setDrawerOpen(false), [])
    return {open, drawerOpen, closeDrawer}
}
