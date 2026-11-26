import {useState, type ReactNode} from "react"

import type {PhoneSection} from "@agenta/entity-ui/drill-in"
import {useT} from "@agenta/i18n"
import agentLayoutHeaderCatalog from "@agenta/i18n/catalogs/agentLayout.header"
import agentLayoutPanelCatalog from "@agenta/i18n/catalogs/agentLayout.panel"
import agentPagesPhoneCatalog from "@agenta/i18n/catalogs/agentPages.phone"
import {AgentRevisionStatus} from "@agenta/playground-ui/agent-page-header"
import {BuilderIcon} from "@agenta/ui/agent-icon"
import {PhoneScreenHeader} from "@agenta/ui/phone"
import {cn} from "@agenta/ui/styles"
import {Button, Tabs, TabsList, TabsTrigger} from "@agenta/ui/ui"
import {useSetAtom} from "jotai"

import {ConfigPane} from "../chat/ConfigPane"
import {selectedRevisionAtomFamily} from "../chat/selectedRevision"

import {AccessTab} from "./AccessTab"
import {useAgentPanel} from "./agentPanelContext"
import type {ConfigTab} from "./agentPanelState"
import {AutomationsTab} from "./AutomationsTab"
import {ChannelsTab} from "./ChannelsTab"
import type {ConfigurationContentProps} from "./ConfigurationContent"
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
    sessionId,
    filesScope,
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
    const pinRevision = useSetAtom(selectedRevisionAtomFamily(sessionId))
    const tabs = panel.phone ? PHONE_TABS : TABS
    const configTab = shownConfigTab(panel)
    // The pane's own entry animates its first tab; only a tab switch animates the tab body.
    const [tabSwitched, setTabSwitched] = useState(false)
    const selectTab = (tab: ConfigTab) => {
        onCloseSection()
        panel.setConfigTab(tab)
        setTabSwitched(true)
    }
    // The kit Tabs (TabsList, 32 px) inside the pane header. Selection runs on click, so a key
    // press moves focus and Enter or Space selects (one Tab stop for the row).
    const tabTriggers = (
        <TabsList
            className={cn(
                // In the 320 px pane four tabs and Close do not fit: the row scrolls, never overlaps.
                "ag-scroll-no-bar min-w-0 shrink justify-start overflow-x-auto",
                // The full header height, so the underline sits on the header's bottom line.
                "h-auto self-stretch",
            )}
        >
            {tabs.map((tab) => (
                <TabsTrigger
                    key={tab.key}
                    value={tab.key}
                    id={`agent-config-tab-${tab.key}`}
                    aria-controls="agent-config-tabpanel"
                    className="flex-none"
                    onClick={() => selectTab(tab.key)}
                >
                    {t(`agentLayout.panel.${tab.label}`)}
                </TabsTrigger>
            ))}
        </TabsList>
    )
    const tabRow = (className: string, trailing: ReactNode) => (
        <Tabs value={configTab} activationMode="manual" className={className}>
            {tabTriggers}
            {trailing}
        </Tabs>
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
                        {/* The tabs, and on the Agent tab the version status at the end of the
                            row (M07; version control is only on the Agent tab, M10). */}
                        {tabRow(
                            "box-border h-10 shrink-0 flex-row items-center justify-between gap-1 border-0 border-b border-solid border-border-muted pl-1.5 pr-4",
                            configTab === "agent" ? (
                                <AgentRevisionStatus
                                    revisionId={revisionId}
                                    historyWorkflowId={agentId}
                                    onUpdate={pinRevision}
                                    checkKey={sessionId}
                                    phone
                                    backTitle={t("agentLayout.header.configuration")}
                                    className="shrink-0"
                                />
                            ) : null,
                        )}
                    </>
                )
            ) : (
                // The pane header: the session bar's 48 px, the tab text on the pane's 24 px line.
                tabRow(
                    "box-border h-12 shrink-0 flex-row items-center justify-between gap-2 border-0 border-b border-solid border-border-muted pl-3.5 pr-3",
                    <PanelCloseButton />,
                )
            )}
            <div
                id="agent-config-tabpanel"
                role="tabpanel"
                aria-labelledby={`agent-config-tab-${configTab}`}
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
                        sessionId={sessionId}
                        filesScope={filesScope}
                        projectId={projectId}
                    />
                ) : configTab === "channels" ? (
                    <ChannelsTab
                        agentId={agentId}
                        workspaceId={workspaceId}
                        projectId={projectId}
                        // The pane's own 24 px margins (`panel-side`).
                        className={panel.phone ? undefined : "px-6"}
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
        </div>
    )
}
