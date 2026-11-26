import {useT} from "@agenta/i18n"
import agentLayoutPanelCatalog from "@agenta/i18n/catalogs/agentLayout.panel"
import {cn} from "@agenta/ui/styles"
import dynamic from "next/dynamic"

import {useAgentPanel} from "./agentPanelContext"
import {PaneBackView} from "./PaneBackView"

// Loaded when the tab first opens: the channel views are not part of the session screen.
const AgentChannels = dynamic(() =>
    import("../agent-pages/AgentChannels").then((m) => m.AgentChannels),
)

/** The Channels tab of the agent's right panel: the same view as the agent's Channels page. */
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
    const panel = useAgentPanel()
    return (
        <div className={cn("h-full min-h-0 overflow-y-auto p-4", className)}>
            <AgentChannels
                agentId={agentId}
                workspaceId={workspaceId}
                projectId={projectId}
                // An open channel view takes the pane header's back link; a phone keeps its sheet.
                renderOpenView={
                    panel.phone
                        ? undefined
                        : (view) => (
                              <PaneBackView
                                  back={{
                                      title: view.onBack
                                          ? view.title
                                          : t("agentLayout.panel.channels"),
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
