import type {PhoneSection} from "@agenta/entity-ui/drill-in"
import {useT} from "@agenta/i18n"
import agentLayoutHeaderCatalog from "@agenta/i18n/catalogs/agentLayout.header"
import agentLayoutPanelCatalog from "@agenta/i18n/catalogs/agentLayout.panel"
import agentPagesPhoneCatalog from "@agenta/i18n/catalogs/agentPages.phone"
import {AgentRevisionStatus} from "@agenta/playground-ui/agent-page-header"
import {BuilderIcon} from "@agenta/ui/agent-icon"
import {PhoneScreenHeader} from "@agenta/ui/phone"
import {cn} from "@agenta/ui/styles"
import {Button} from "@agenta/ui/ui"
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
    const selectTab = (tab: ConfigTab) => {
        onCloseSection()
        panel.setConfigTab(tab)
    }
    const tabList = (
        <div
            role="tablist"
            className={cn(
                "flex min-w-0 flex-1 self-stretch",
                // A long word in another language scrolls the row, never the screen.
                panel.phone ? "ag-scroll-no-bar gap-5 overflow-x-auto" : "ml-2.5 gap-3.5",
            )}
            onKeyDown={(event) => {
                // Arrow keys move between the tabs (one Tab stop for the row).
                const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0
                if (!step) return
                event.preventDefault()
                const index = tabs.findIndex((tab) => tab.key === configTab)
                const next = tabs[(index + step + tabs.length) % tabs.length]
                selectTab(next.key)
                document.getElementById(`agent-config-tab-${next.key}`)?.focus()
            }}
        >
            {tabs.map((tab) => (
                <button
                    key={tab.key}
                    id={`agent-config-tab-${tab.key}`}
                    type="button"
                    role="tab"
                    aria-selected={configTab === tab.key}
                    aria-controls="agent-config-tabpanel"
                    tabIndex={configTab === tab.key ? 0 : -1}
                    // Underline tabs (canvas S02, M07): the open tab has a 2 px bar on the row's line.
                    className={cn(
                        "relative flex shrink-0 items-center truncate rounded-none",
                        panel.phone ? "h-11 min-w-11 px-0 text-sm" : "px-0.5 text-[13px]",
                        configTab === tab.key
                            ? "font-medium text-colorText after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-[1px] after:bg-colorText after:content-['']"
                            : "text-colorTextSecondary hover:text-colorText",
                    )}
                    onClick={() => selectTab(tab.key)}
                >
                    {t(`agentLayout.panel.${tab.label}`)}
                </button>
            ))}
        </div>
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
                        <div className="flex shrink-0 items-center gap-1 border-0 border-b border-solid border-colorBorderSecondary pl-4 pr-1">
                            {tabList}
                            {configTab === "agent" ? (
                                <AgentRevisionStatus
                                    revisionId={revisionId}
                                    historyWorkflowId={agentId}
                                    onUpdate={pinRevision}
                                    checkKey={sessionId}
                                    phone
                                    backTitle={t("agentLayout.header.configuration")}
                                    className="shrink-0"
                                />
                            ) : null}
                        </div>
                    </>
                )
            ) : (
                <div className="flex h-12 shrink-0 items-center border-0 border-b border-solid border-colorBorderSecondary pl-1 pr-1.5">
                    {tabList}
                    <PanelCloseButton />
                </div>
            )}
            <div
                id="agent-config-tabpanel"
                role="tabpanel"
                aria-labelledby={`agent-config-tab-${configTab}`}
                className="min-h-0 flex-1"
            >
                {configTab === "agent" ? (
                    <div className="flex h-full min-h-0 flex-col">
                        <div className="min-h-0 flex-1">
                            <ConfigPane entityId={revisionId} />
                        </div>
                        {panel.phone ? null : (
                            // Save status and version in the footer (S02, configuration-draft).
                            <div className="flex shrink-0 justify-end border-0 border-t border-solid border-colorBorderSecondary p-3">
                                <AgentRevisionStatus
                                    revisionId={revisionId}
                                    historyWorkflowId={agentId}
                                    // The newest status draws the history drawer: keep its
                                    // "Update to vN", as the header's status passes it.
                                    onUpdate={pinRevision}
                                    checkKey={sessionId}
                                    footer
                                />
                            </div>
                        )}
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
                    />
                ) : (
                    <AccessTab agentId={agentId} workspaceId={workspaceId} projectId={projectId} />
                )}
            </div>
        </div>
    )
}
