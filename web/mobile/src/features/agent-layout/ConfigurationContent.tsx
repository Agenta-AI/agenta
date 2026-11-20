import {useT} from "@agenta/i18n"
import agentLayoutPanelCatalog from "@agenta/i18n/catalogs/agentLayout.panel"
import {ViewStackHost} from "@agenta/ui/view-stack"

import {useAgentPanel} from "./agentPanelContext"
import {ConfigurationRoot} from "./ConfigurationRoot"
import {PanelViewChrome} from "./PanelViewChrome"
import {StackGuards} from "./StackGuards"

export interface ConfigurationContentProps {
    agentId: string
    revisionId: string
    sessionId: string
    filesScope: string
    workspaceId: string
    projectId: string
}

/**
 * The Configuration content of the right panel: four tabs over one view stack. The sections keep
 * today's bodies and drawers; a view opened from a tab shows with the panel chrome.
 */
export const ConfigurationContent = (props: ConfigurationContentProps) => {
    const t = useT(agentLayoutPanelCatalog)
    const panel = useAgentPanel()
    return (
        <ViewStackHost
            chrome={PanelViewChrome}
            rootTitle={t(`agentLayout.panel.${panel.configTab}`)}
        >
            <StackGuards />
            <ConfigurationRoot {...props} />
        </ViewStackHost>
    )
}
