import {useContext} from "react"

import {useT} from "@agenta/i18n"
import agentLayoutPanelCatalog from "@agenta/i18n/catalogs/agentLayout.panel"
import {cn} from "@agenta/ui/styles"
import dynamic from "next/dynamic"

import {PaneBackView} from "./PaneBackView"
import {PanelChromeContext} from "./PanelViewChrome"

// Loaded when the tab first opens: the channel views are not part of the session screen.
const AgentChannels = dynamic(() =>
    import("../agent-pages/AgentChannels").then((m) => m.AgentChannels),
)

/** The Channels tab of the agent pane: the same view as the agent's Channels page. */
export const ChannelsTab = ({
    agentId,
    workspaceId,
    projectId,
    className,
}: {
    agentId: string
    workspaceId: string
    projectId: string
    className?: string
}) => {
    const t = useT(agentLayoutPanelCatalog)
    const {phone} = useContext(PanelChromeContext)
    return (
        // A flex column, so an open view fills it and its footer sits at the bottom.
        <div className={cn("flex h-full min-h-0 flex-col overflow-y-auto p-4", className)}>
            <AgentChannels
                agentId={agentId}
                workspaceId={workspaceId}
                projectId={projectId}
                // An open channel view takes the pane header's back link; a phone keeps its sheet.
                renderOpenView={
                    phone
                        ? undefined
                        : (view) => (
                              <PaneBackView
                                  className="flex flex-1 flex-col"
                                  back={{
                                      title: view.onBack
                                          ? view.title
                                          : t("agentLayout.panel.channels"),
                                      current: view.onBack ? undefined : view.title,
                                      onBack: view.onBack ?? view.onClose,
                                  }}
                              >
                                  {view.children}
                              </PaneBackView>
                          )
                }
            />
        </div>
    )
}
