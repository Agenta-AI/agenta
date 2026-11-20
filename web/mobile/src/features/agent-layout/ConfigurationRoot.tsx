import type {PhoneSection} from "@agenta/entity-ui/drill-in"
import {useT} from "@agenta/i18n"
import agentLayoutHeaderCatalog from "@agenta/i18n/catalogs/agentLayout.header"
import agentLayoutPanelCatalog from "@agenta/i18n/catalogs/agentLayout.panel"
import agentPagesPhoneCatalog from "@agenta/i18n/catalogs/agentPages.phone"
import {AgentRevisionStatus} from "@agenta/playground-ui/agent-page-header"
import {PhoneScreenHeader} from "@agenta/ui/phone"
import {cn} from "@agenta/ui/styles"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {Hammer, X} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import {ConfigPane} from "../chat/ConfigPane"
import {selectedRevisionAtomFamily} from "../chat/selectedRevision"

import {AccessTab} from "./AccessTab"
import {useAgentPanel} from "./agentPanelContext"
import type {ConfigTab} from "./agentPanelState"
import {AutomationsTab} from "./AutomationsTab"
import {ChannelsTab} from "./ChannelsTab"
import type {ConfigurationContentProps} from "./ConfigurationContent"

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
    const configTab = panel.phone && panel.configTab === "channels" ? "agent" : panel.configTab
    const selectTab = (tab: ConfigTab) => {
        onCloseSection()
        panel.setConfigTab(tab)
    }
    const tabList = (
        <div
            role="tablist"
            className={cn(
                "flex min-w-0 flex-1 items-center gap-1",
                // A long word in another language scrolls the row, never the screen.
                panel.phone && "ag-scroll-no-bar overflow-x-auto",
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
                    className={cn(
                        "min-w-11 truncate",
                        panel.phone
                            ? "h-11 shrink-0 rounded-none px-2 text-[15px]"
                            : "h-8 rounded-md px-2 text-sm",
                        configTab === tab.key
                            ? panel.phone
                                ? "font-medium text-colorText shadow-[inset_0_-2px_0_currentColor]"
                                : "bg-colorFillSecondary font-medium text-colorText"
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
                                        size="icon-sm"
                                        aria-label={t("agentLayout.header.builder")}
                                        className="size-11"
                                        onClick={() => void panel.toggle("builder")}
                                    >
                                        <Hammer size={18} />
                                    </Button>
                                ) : null
                            }
                        />
                        {/* The tabs, and the version status at the end of the row (M07). */}
                        <div className="flex shrink-0 items-center gap-1 border-0 border-b border-solid border-colorBorderSecondary pl-2 pr-1">
                            {tabList}
                            <AgentRevisionStatus
                                revisionId={revisionId}
                                historyWorkflowId={agentId}
                                onUpdate={pinRevision}
                                checkKey={sessionId}
                                phone
                                backTitle={t("agentLayout.header.configuration")}
                                className="shrink-0"
                            />
                        </div>
                    </>
                )
            ) : (
                <div className="flex h-12 shrink-0 items-center gap-1 border-0 border-b border-solid border-colorBorderSecondary px-3">
                    {tabList}
                    <SimpleTooltip title={t("agentLayout.panel.close")}>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("agentLayout.panel.close")}
                            onClick={() => void panel.close()}
                        >
                            <X size={16} />
                        </Button>
                    </SimpleTooltip>
                </div>
            )}
            <div
                id="agent-config-tabpanel"
                role="tabpanel"
                aria-labelledby={`agent-config-tab-${configTab}`}
                className="min-h-0 flex-1"
            >
                {configTab === "agent" ? (
                    <ConfigPane entityId={revisionId} />
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
