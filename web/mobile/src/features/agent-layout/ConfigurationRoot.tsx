import {useState} from "react"

import type {PhoneSection} from "@agenta/entity-ui/drill-in"
import {cn} from "@agenta/ui/styles"
import {PANE_FOOTER_CLASS, PaneFooterSlotContext} from "@agenta/ui/view-stack"

import {ConfigPane} from "../chat/ConfigPane"

import {AccessTab} from "./AccessTab"
import {AGENT_CONFIG_TABPANEL_ID, agentConfigTabId} from "./AgentConfigTabs"
import {useAgentPanel} from "./agentPanelContext"
import type {ConfigTab} from "./agentPanelState"
import {AutomationsTab} from "./AutomationsTab"
import {ChannelsTab} from "./ChannelsTab"
import type {ConfigurationContentProps} from "./ConfigurationContent"
import {ConfigurationHeader} from "./ConfigurationHeader"
import {PaneBackContext, type PaneBack} from "./paneBack"
import {shownConfigTab} from "./shownConfigTab"

/**
 * The root of the Configuration content: the four tabs and the open tab's body. On a phone (M07)
 * it is a full screen: the back arrow to the session, three tabs with the version status at the
 * end of the tab row, and on the Agent tab a row per section; a section opened from its row shows
 * as its own screen.
 */
export const ConfigurationRoot = ({
    agentId,
    revisionId,
    workspaceId,
    projectId,
    phoneSection,
    onCloseSection,
}: ConfigurationContentProps & {
    /** On a phone, the section shown as its own screen. */
    phoneSection: PhoneSection | null
    onCloseSection: () => void
}) => {
    const panel = useAgentPanel()
    const configTab = shownConfigTab(panel)
    // The pane's own entry animates its first tab; only a tab switch animates the tab body.
    const [tabSwitched, setTabSwitched] = useState(false)
    // A view open inside a tab (a channel's manage view) puts its back link in the header.
    const [paneBack, setPaneBack] = useState<PaneBack | null>(null)
    // Its action row, drawn by the pane like a stack view's (`PaneFooter`).
    const [footerSlot, setFooterSlot] = useState<HTMLDivElement | null>(null)
    const selectTab = (tab: ConfigTab) => {
        onCloseSection()
        panel.setConfigTab(tab)
        setTabSwitched(true)
    }
    return (
        <div data-pane="" className="ag-panel-raised flex h-full min-h-0 flex-col">
            <ConfigurationHeader
                configTab={configTab}
                onSelectTab={selectTab}
                paneBack={paneBack}
                phoneSection={phoneSection}
                onCloseSection={onCloseSection}
            />
            <PaneBackContext.Provider value={setPaneBack}>
                <PaneFooterSlotContext.Provider value={panel.phone ? null : footerSlot}>
                    <div
                        id={AGENT_CONFIG_TABPANEL_ID}
                        role="tabpanel"
                        aria-labelledby={agentConfigTabId(configTab)}
                        className={cn("min-h-0 flex-1", tabSwitched && "ag-view-enter-children")}
                    >
                        {configTab === "agent" ? (
                            // Save status and History live in the session header's version pill.
                            <div className="flex h-full min-h-0 flex-col">
                                <ConfigPane entityId={revisionId} />
                            </div>
                        ) : configTab === "automations" ? (
                            <AutomationsTab
                                revisionId={revisionId}
                                workspaceId={workspaceId}
                                projectId={projectId}
                            />
                        ) : configTab === "channels" ? (
                            <ChannelsTab
                                agentId={agentId}
                                workspaceId={workspaceId}
                                projectId={projectId}
                            />
                        ) : (
                            <AccessTab
                                agentId={agentId}
                                workspaceId={workspaceId}
                                projectId={projectId}
                            />
                        )}
                    </div>
                </PaneFooterSlotContext.Provider>
            </PaneBackContext.Provider>
            {panel.phone ? null : <div ref={setFooterSlot} className={PANE_FOOTER_CLASS} />}
        </div>
    )
}
