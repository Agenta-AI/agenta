import {workflowMolecule} from "@agenta/entities/workflow"
import {AgentPageHeader, AgentRevisionStatus} from "@agenta/playground-ui/agent-page-header"
import {PlaygroundModeSwitch} from "@agenta/playground-ui/mode-switch"
import {useAtomValue, useSetAtom} from "jotai"

import {NavDrawer} from "../nav/NavDrawer"

import {selectedRevisionAtomFamily} from "./selectedRevision"

/**
 * The session workspace's top bar — the desktop playground's header on this surface: which agent
 * you are working on, which revision, whether it is saved, and the Build/Chat switch.
 *
 * It spans both panes (config and conversation), exactly as the desktop bar spans its panels, so
 * the identity belongs to the workspace and not to either pane.
 */
export const SessionTopBar = ({
    entityId,
    agentId,
    sessionId,
    workspaceId,
    projectId,
}: {
    /** The revision under edit. Absent = a session with no turns yet (nothing committed to show). */
    entityId: string | null
    agentId?: string | null
    sessionId: string
    workspaceId: string
    projectId: string
}) => {
    // artifactName resolves from a revision id or a workflow id, so either handle names the agent.
    const name = useAtomValue(workflowMolecule.selectors.artifactName(entityId ?? agentId ?? ""))
    // Picking a revision pins the whole workspace to it (config AND the conversation's target),
    // as on the desktop; the pin lives per session and clears on commit.
    const pinRevision = useSetAtom(selectedRevisionAtomFamily(sessionId))

    return (
        <AgentPageHeader
            // Nav is the DRAWER here, as on every other screen in this app — not a bespoke back
            // chevron. It hides itself at lg, where the rail takes over and the bar then opens with
            // the agent icon exactly like the desktop playground's. Getting back to the sessions
            // list is the drawer's Sessions entry, or the tab rail above the conversation.
            leading={<NavDrawer workspaceId={workspaceId} projectId={projectId} />}
            name={name || "Agent"}
            revision={
                entityId ? (
                    <AgentRevisionStatus
                        revisionId={entityId}
                        pickerWorkflowId={agentId}
                        onSelectRevision={pinRevision}
                    />
                ) : undefined
            }
            actions={<PlaygroundModeSwitch />}
        />
    )
}
