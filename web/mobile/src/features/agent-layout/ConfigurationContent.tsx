import {AgentRevisionContext} from "@agenta/entity-ui/drill-in"
import {useT} from "@agenta/i18n"
import agentLayoutPanelCatalog from "@agenta/i18n/catalogs/agentLayout.panel"
import {ViewStackHost} from "@agenta/ui/view-stack"
import {useSetAtom} from "jotai"

import {DrillInBridgeProvider} from "../chat/DrillInBridgeProvider"
import {selectedRevisionAtomFamily} from "../chat/selectedRevision"

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
    // A commit made here pins the new revision to this session.
    const pinRevision = useSetAtom(selectedRevisionAtomFamily(props.sessionId))
    return (
        // Open agent views follow the revision on screen as auto-save replaces it.
        // The DrillIn bridge holds the stack, so an open view gets the same host parts (model
        // providers, skills, subagents) as the tab's root.
        <DrillInBridgeProvider
            projectId={props.projectId}
            onWorkflowRevisionCommitted={pinRevision}
        >
            <AgentRevisionContext.Provider value={props.revisionId}>
                <ViewStackHost
                    chrome={PanelViewChrome}
                    rootTitle={t(`agentLayout.panel.${panel.configTab}`)}
                >
                    <StackGuards />
                    <ConfigurationRoot {...props} />
                </ViewStackHost>
            </AgentRevisionContext.Provider>
        </DrillInBridgeProvider>
    )
}
