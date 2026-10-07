import {workflowMolecule} from "@agenta/entities/workflow"
import {AgentIdentity} from "@agenta/entity-ui/agent"
import {AgentPageHeader, AgentRevisionStatus} from "@agenta/playground-ui/agent-page-header"
import {ShortcutsHelpButton} from "@agenta/ui/shortcuts"
import {useAtomValue} from "jotai"

import {NavDrawer} from "../nav/NavDrawer"

import {ShareMenu} from "./ShareMenu"

/**
 * The session workspace's top bar — the desktop playground's header on this surface: which agent
 * you are working on, which revision, and whether it is saved.
 *
 * No Build/Chat switch: the desktop hides it too (`SHOW_MODE_SWITCH = false` in its playground
 * header). The config panel is shown or collapsed, and that is the whole model — a mode switch on
 * top of a collapse gives two controls for one piece of state.
 *
 * It spans both panes (config and conversation), exactly as the desktop bar spans its panels, so
 * the identity belongs to the workspace and not to either pane.
 */
export const SessionTopBar = ({
    entityId,
    sessionId,
    onUpdate,
    agentId,
    workspaceId,
    projectId,
}: {
    /** The revision under edit. Absent = a session with no turns yet (nothing committed to show). */
    entityId: string | null
    /** The session on screen; the Share menu's template items send their request here. */
    sessionId: string
    /** Pin this session to a newer version the user asked for. */
    onUpdate: (revisionId: string) => void
    agentId?: string | null
    workspaceId: string
    projectId: string
}) => {
    // artifactName resolves from a revision id or a workflow id, so either handle names the agent.
    const name = useAtomValue(workflowMolecule.selectors.artifactName(entityId ?? agentId ?? ""))

    return (
        <AgentPageHeader
            // Nav is the DRAWER here, as on every other screen in this app — not a bespoke back
            // chevron. It hides itself at lg, where the rail takes over and the bar then opens with
            // the agent icon exactly like the desktop playground's. Getting back to the sessions
            // list is the drawer's Sessions entry, or the tab rail above the conversation.
            leading={<NavDrawer workspaceId={workspaceId} projectId={projectId} />}
            // One slot for both halves: the shared identity owns the chip and the inline rename,
            // and falls back to a plain chip + label when no agent is resolved yet.
            identity={<AgentIdentity workflowId={agentId} name={name || "Agent"} />}
            revision={
                entityId ? (
                    <AgentRevisionStatus
                        revisionId={entityId}
                        historyWorkflowId={agentId}
                        onUpdate={onUpdate}
                        checkKey={sessionId}
                    />
                ) : undefined
            }
            // The desktop puts this at the header's right edge too, not on the tab strip.
            actions={
                <>
                    {/* Keyboard shortcuts mean nothing on a phone. */}
                    <ShortcutsHelpButton className="hidden h-7 w-7 shrink-0 p-0 md:inline-flex" />
                    {agentId ? (
                        <>
                            <span
                                aria-hidden
                                className="hidden h-5 w-px shrink-0 bg-colorBorderSecondary md:block"
                            />
                            <ShareMenu
                                agentId={agentId}
                                sessionId={sessionId}
                                // No revision = read-only replay: no conversation to send into.
                                canRequestTemplate={Boolean(entityId)}
                                workspaceId={workspaceId}
                                projectId={projectId}
                            />
                        </>
                    ) : null}
                </>
            }
        />
    )
}
