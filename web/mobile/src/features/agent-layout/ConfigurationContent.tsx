import {useMemo, useState} from "react"

import {AgentEditorContext, type AgentEditor} from "@agenta/entity-ui/drill-in"
import {useT} from "@agenta/i18n"
import agentLayoutPanelCatalog from "@agenta/i18n/catalogs/agentLayout.panel"
import {ViewStackHost} from "@agenta/ui/view-stack"
import {useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {DrillInBridgeProvider} from "../chat/DrillInBridgeProvider"
import {selectedRevisionAtomFamily} from "../chat/selectedRevision"
import {useProjectPermissionState} from "../context/useProjectPermission"

import {useAgentPanel} from "./agentPanelContext"
import {ConfigurationRoot} from "./ConfigurationRoot"
import {PanelViewChrome} from "./PanelViewChrome"
import {StackGuards} from "./StackGuards"

// The channel read loads on its own: its code is not part of the Configuration chunk.
const AgentChannelPresence = dynamic(() => import("./AgentChannelPresence"), {ssr: false})

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
    // The API refuses a Viewer's edits; this keeps the editor and its open views from offering
    // them. Editing stays open while the check is in flight, so people who may edit do not see it
    // lock and unlock.
    const editAccess = useProjectPermissionState(props.projectId, "edit_workflows")
    const readOnly = !editAccess.pending && !editAccess.allowed
    // A channel run has no person: integrations that use each person's own account warn.
    const [hasChannel, setHasChannel] = useState<boolean | undefined>(undefined)
    const editor = useMemo<AgentEditor>(
        () => ({revisionId: props.revisionId, readOnly, hasChannel}),
        [props.revisionId, readOnly, hasChannel],
    )
    return (
        // Open agent views follow the revision on screen (auto-save replaces it) and the edit right.
        // The DrillIn bridge holds the stack, so an open view gets the same host parts (model
        // providers, skills, subagents) as the tab's root.
        <DrillInBridgeProvider
            projectId={props.projectId}
            onWorkflowRevisionCommitted={pinRevision}
        >
            {/* Read again each time the Agent tab opens, so a change in the Channels tab shows. */}
            {panel.configTab === "agent" ? (
                <AgentChannelPresence agentId={props.agentId} onChange={setHasChannel} />
            ) : null}
            <AgentEditorContext.Provider value={editor}>
                <ViewStackHost
                    chrome={PanelViewChrome}
                    rootTitle={t(`agentLayout.panel.${panel.configTab}`)}
                >
                    <StackGuards />
                    <ConfigurationRoot {...props} />
                </ViewStackHost>
            </AgentEditorContext.Provider>
        </DrillInBridgeProvider>
    )
}
