import {useT} from "@agenta/i18n"
import chatMobileConfigCatalog from "@agenta/i18n/catalogs/chat.mobileConfig"
import {
    AgentSectionCardsSkeleton,
    AgentSectionRowsSkeleton,
} from "@agenta/ui/components/presentational"

import {useAgentPanel} from "../../agent-layout/agentPanelContext"
import {ConfigurationHeader} from "../../agent-layout/ConfigurationHeader"
import {shownConfigTab} from "../../agent-layout/shownConfigTab"

/**
 * The Configuration content while its chunk loads: its real header (the tab row, or the phone's
 * back arrow over the tabs), then the Agent tab's cards or phone rows, as loaded.
 */
export const ConfigPaneLoading = () => {
    const t = useT(chatMobileConfigCatalog)
    const panel = useAgentPanel()
    const configTab = shownConfigTab(panel)
    return (
        <div className="ag-panel-raised flex h-full min-h-0 w-full flex-col">
            <ConfigurationHeader configTab={configTab} onSelectTab={panel.setConfigTab} />
            <div
                role="status"
                aria-busy
                aria-label={t("chat.mobileConfig.loadingConfiguration")}
                className="min-h-0 flex-1 overflow-hidden px-4"
            >
                {configTab !== "agent" ? null : panel.phone ? (
                    <AgentSectionRowsSkeleton />
                ) : (
                    <AgentSectionCardsSkeleton />
                )}
            </div>
        </div>
    )
}
