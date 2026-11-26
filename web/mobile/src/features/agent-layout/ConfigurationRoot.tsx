import {useState, type ReactNode} from "react"

import type {PhoneSection} from "@agenta/entity-ui/drill-in"
import {useT} from "@agenta/i18n"
import agentLayoutHeaderCatalog from "@agenta/i18n/catalogs/agentLayout.header"
import agentLayoutPanelCatalog from "@agenta/i18n/catalogs/agentLayout.panel"
import agentPagesPhoneCatalog from "@agenta/i18n/catalogs/agentPages.phone"
import {BuilderIcon} from "@agenta/ui/agent-icon"
import {PhoneScreenHeader} from "@agenta/ui/phone"
import {cn} from "@agenta/ui/styles"
import {Button} from "@agenta/ui/ui"

import {ConfigPane} from "../chat/ConfigPane"

import {AccessTab} from "./AccessTab"
import {AGENT_CONFIG_TABPANEL_ID, AgentConfigTabs, agentConfigTabId} from "./AgentConfigTabs"
import {useAgentPanel} from "./agentPanelContext"
import type {ConfigTab} from "./agentPanelState"
import {AutomationsTab} from "./AutomationsTab"
import {ChannelsTab} from "./ChannelsTab"
import type {ConfigurationContentProps} from "./ConfigurationContent"
import {PaneBackContext, type PaneBack} from "./paneBack"
import {PanelCloseButton} from "./PanelCloseButton"
import {shownConfigTab} from "./shownConfigTab"

const TABS: {key: ConfigTab; label: "agent" | "automations" | "channels" | "access"}[] = [
    {key: "agent", label: "agent"},
    {key: "automations", label: "automations"},
    {key: "channels", label: "channels"},
    {key: "access", label: "access"},
]

// Channels is a page of its own on a phone (the agent sidebar opens it).
const PHONE_TABS = TABS.filter((tab) => tab.key !== "channels")

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
    const t = useT(agentLayoutPanelCatalog, agentLayoutHeaderCatalog, agentPagesPhoneCatalog)
    const panel = useAgentPanel()
    const tabs = panel.phone ? PHONE_TABS : TABS
    const configTab = shownConfigTab(panel)
    // The pane's own entry animates its first tab; only a tab switch animates the tab body.
    const [tabSwitched, setTabSwitched] = useState(false)
    // A view open inside a tab (a channel's manage view) puts its back link in the header.
    const [paneBack, setPaneBack] = useState<PaneBack | null>(null)
    const selectTab = (tab: ConfigTab) => {
        onCloseSection()
        panel.setConfigTab(tab)
        setTabSwitched(true)
    }
    const tabRow = (back: PaneBack | null, trailing?: ReactNode) => (
        <AgentConfigTabs
            tabs={tabs.map((tab) => ({key: tab.key, label: t(`agentLayout.panel.${tab.label}`)}))}
            value={configTab}
            onSelect={selectTab}
            phone={panel.phone}
            back={back}
            trailing={trailing}
        />
    )
    return (
        <div className="ag-panel-raised flex h-full min-h-0 flex-col">
            {panel.phone ? (
                phoneSection ? (
                    <PhoneScreenHeader
                        title={phoneSection.title}
                        backTitle={t("agentLayout.header.configuration")}
                        onBack={onCloseSection}
                    />
                ) : (
                    <>
                        <PhoneScreenHeader
                            title={t("agentLayout.header.configuration")}
                            hideTitle
                            backTitle={t("agentPages.phone.session")}
                            onBack={() => void panel.close()}
                            trailing={
                                panel.available.builder ? (
                                    <Button
                                        variant="ghost"
                                        size="icon-compact"
                                        aria-label={t("agentLayout.header.builder")}
                                        onClick={() => void panel.toggle("builder")}
                                    >
                                        <BuilderIcon />
                                    </Button>
                                ) : null
                            }
                        />
                        {/* The tabs; History lives in the More sheet on a phone. */}
                        {tabRow(null)}
                    </>
                )
            ) : (
                // The pane header: the session bar's 48 px, the tab text on the pane's 24 px line.
                tabRow(paneBack, <PanelCloseButton onClose={() => void panel.close()} />)
            )}
            <PaneBackContext.Provider value={setPaneBack}>
                <div
                    id={AGENT_CONFIG_TABPANEL_ID}
                    role="tabpanel"
                    aria-labelledby={agentConfigTabId(configTab)}
                    className={cn("min-h-0 flex-1", tabSwitched && "ag-view-enter-children")}
                >
                    {configTab === "agent" ? (
                        // Save status and History live in the session header's version pill.
                        <div className="flex h-full min-h-0 flex-col">
                            <ConfigPane entityId={revisionId} inset={!panel.phone} />
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
                            // The pane's own 24 px margins; the footer band bleeds by the same.
                            className={
                                panel.phone ? undefined : "px-6 [--panel-bleed-x:--spacing(6)]"
                            }
                        />
                    ) : (
                        <AccessTab
                            agentId={agentId}
                            workspaceId={workspaceId}
                            projectId={projectId}
                            className={panel.phone ? undefined : "px-6"}
                        />
                    )}
                </div>
            </PaneBackContext.Provider>
        </div>
    )
}
