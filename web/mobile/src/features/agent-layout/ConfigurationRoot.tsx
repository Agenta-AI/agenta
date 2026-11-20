import {useT} from "@agenta/i18n"
import agentLayoutPanelCatalog from "@agenta/i18n/catalogs/agentLayout.panel"
import {cn} from "@agenta/ui/styles"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {ArrowLeft, X} from "@phosphor-icons/react"

import {ConfigPane} from "../chat/ConfigPane"

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

/** The root of the Configuration content: the four tabs and the open tab's body. */
export const ConfigurationRoot = ({
    agentId,
    revisionId,
    sessionId,
    filesScope,
    workspaceId,
    projectId,
}: ConfigurationContentProps) => {
    const t = useT(agentLayoutPanelCatalog)
    const panel = useAgentPanel()
    return (
        <div className="ag-panel-raised flex h-full min-h-0 flex-col">
            <div className="flex h-12 shrink-0 items-center gap-1 border-0 border-b border-solid border-colorBorderSecondary px-3">
                {panel.phone ? (
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("agentLayout.panel.back")}
                        className="size-11 shrink-0"
                        onClick={() => void panel.close()}
                    >
                        <ArrowLeft size={18} />
                    </Button>
                ) : null}
                <div
                    role="tablist"
                    className="flex min-w-0 flex-1 items-center gap-1"
                    onKeyDown={(event) => {
                        // Arrow keys move between the tabs (one Tab stop for the row).
                        const step =
                            event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0
                        if (!step) return
                        event.preventDefault()
                        const index = TABS.findIndex((tab) => tab.key === panel.configTab)
                        const next = TABS[(index + step + TABS.length) % TABS.length]
                        panel.setConfigTab(next.key)
                        document.getElementById(`agent-config-tab-${next.key}`)?.focus()
                    }}
                >
                    {TABS.map((tab) => (
                        <button
                            key={tab.key}
                            id={`agent-config-tab-${tab.key}`}
                            type="button"
                            role="tab"
                            aria-selected={panel.configTab === tab.key}
                            aria-controls="agent-config-tabpanel"
                            tabIndex={panel.configTab === tab.key ? 0 : -1}
                            className={cn(
                                "h-8 min-w-11 truncate rounded-md px-2 text-sm",
                                panel.configTab === tab.key
                                    ? "bg-colorFillSecondary font-medium text-colorText"
                                    : "text-colorTextSecondary hover:text-colorText",
                            )}
                            onClick={() => panel.setConfigTab(tab.key)}
                        >
                            {t(`agentLayout.panel.${tab.label}`)}
                        </button>
                    ))}
                </div>
                {panel.phone ? null : (
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
                )}
            </div>
            <div
                id="agent-config-tabpanel"
                role="tabpanel"
                aria-labelledby={`agent-config-tab-${panel.configTab}`}
                className="min-h-0 flex-1"
            >
                {panel.configTab === "agent" ? (
                    <ConfigPane entityId={revisionId} sessionId={sessionId} projectId={projectId} />
                ) : panel.configTab === "automations" ? (
                    <AutomationsTab
                        revisionId={revisionId}
                        sessionId={sessionId}
                        filesScope={filesScope}
                        projectId={projectId}
                    />
                ) : panel.configTab === "channels" ? (
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
