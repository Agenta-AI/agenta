import {useEffect, type ReactNode} from "react"

import {useDriveDirtyGuard} from "@agenta/entities/drive"
import {DriveSessionProvider} from "@agenta/entity-ui/drive"
import {registerAgentAutoCommitHandler} from "@agenta/playground/state"
import {useSetAtom} from "jotai"

import {AgentLayout} from "../agent-layout/AgentLayout"
import {SessionHeader} from "../agent-layout/SessionHeader"
import {useAutomationUrlSync} from "../automations/useAutomationUrlSync"
import {AppShell} from "../nav/AppShell"

import {selectedRevisionAtomFamily} from "./selectedRevision"
import {SessionWorkspaceDrawers} from "./SessionWorkspaceDrawers"
import {SessionWorkspaceShortcuts} from "./SessionWorkspaceShortcuts"
import {useTriggerTestRun} from "./useTriggerTestRun"

/**
 * The session screen: the session header, the conversation and the one right panel (Files,
 * Configuration or Builder) of the agent layout. The conversation is mounted exactly once at
 * every width; the panel decides only what sits beside or over it.
 */
export const SessionWorkspace = ({
    entityId,
    agentId,
    agentResolving = false,
    linkEntityId = entityId,
    linkAgentId = agentId,
    autoUpdateRevision = false,
    agentHidden = false,
    canSend = true,
    sessionId,
    workspaceId,
    projectId,
    chat,
    bare = false,
    deepLinks = false,
}: {
    /** The revision being configured. Absent = nothing to build yet (a session with no turns). */
    entityId: string | null
    agentId?: string | null
    /** The session's agent is still being read; a null `agentId` is not yet the answer. */
    agentResolving?: boolean
    /**
     * This session's own revision and agent, without the last session's held across a switch.
     * A linked automation drawer opens with them. Default: `entityId` and `agentId`.
     */
    linkEntityId?: string | null
    linkAgentId?: string | null
    /** The header moves to a newer version with no click. Default: it offers the version pill. */
    autoUpdateRevision?: boolean
    /** The session's agent is one the reader cannot see (a private agent). */
    agentHidden?: boolean
    /** False when the reader may not send here: the header drops what only a sender uses. */
    canSend?: boolean
    sessionId: string
    workspaceId: string
    projectId: string
    /** The conversation, rendered embedded (it brings its own header, dock and composer). */
    chat: ReactNode
    /**
     * Skip the surrounding `AppShell`. A host that already renders one (first run, which swaps
     * only Home's body) would otherwise stack a second nav rail beside the first.
     */
    bare?: boolean
    /** Mirror the Files pane and the automation drawer in the URL; only where the URL names this session. */
    deepLinks?: boolean
}) => {
    const base = `/w/${workspaceId}/p/${projectId}`
    useAutomationUrlSync({
        enabled: deepLinks,
        ready: !agentResolving && (Boolean(linkEntityId) || !linkAgentId),
        playgroundEntityId: linkEntityId ?? undefined,
        scope: sessionId,
    })
    // Follow the revision an auto-commit produced. Pin it rather than unpinning: unpinning falls
    // back to the latest-revision query, which is stale for a beat, so a commit made FROM an
    // older revision would land the pane on whatever that query last cached.
    //
    // It lives HERE and not in the Configuration content because a commit can land while that
    // content is closed.
    const pinRevision = useSetAtom(selectedRevisionAtomFamily(sessionId))
    useEffect(
        () =>
            registerAgentAutoCommitHandler(
                `session-workspace:${sessionId}`,
                (revisionId, newRevisionId) => {
                    if (revisionId === entityId) pinRevision(newRevisionId)
                },
            ),
        [entityId, pinRevision, sessionId],
    )

    // An automation row's "Test run" (Configuration) lands in a new session with this agent.
    useTriggerTestRun({entityId, agentId, base})
    // Drafts outlive the pane, so the unload guard lives on the host.
    useDriveDirtyGuard()
    // Never a configuration for a hidden agent: its configuration is what the reader may not see.
    const configEntityId = agentHidden ? null : entityId

    const workspace = (
        // Drive surfaces need the AGENT here, not just the session: without it the per-agent
        // mount query stays disabled and `agent-files/…` falls back to the cwd mount (#6270).
        <DriveSessionProvider
            sessionId={sessionId}
            artifactId={agentId ?? null}
            revisionId={configEntityId}
        >
            <div className="ag-app-ground flex h-[calc(var(--ag-viewport-height,100dvh)-var(--ag-top-bars-h,0px))] min-w-0 flex-col pt-[var(--ag-screen-safe-top,env(safe-area-inset-top))]">
                <AgentLayout
                    agentId={agentId ?? null}
                    sessionId={sessionId}
                    revisionId={configEntityId}
                    agentHidden={agentHidden}
                    workspaceId={workspaceId}
                    projectId={projectId}
                    deepLinks={deepLinks}
                    header={
                        <>
                            <SessionWorkspaceShortcuts
                                agentId={agentId ?? null}
                                sessionId={sessionId}
                                base={base}
                                projectId={projectId}
                            />
                            <SessionHeader
                                agentId={agentId ?? null}
                                entityId={entityId}
                                sessionId={sessionId}
                                onUpdate={pinRevision}
                                autoUpdate={autoUpdateRevision}
                                agentHidden={agentHidden}
                                canSend={canSend}
                                workspaceId={workspaceId}
                                projectId={projectId}
                            />
                        </>
                    }
                    conversation={<div className="min-h-0 flex-1">{chat}</div>}
                />
            </div>
            <SessionWorkspaceDrawers workspaceId={workspaceId} projectId={projectId} />
        </DriveSessionProvider>
    )

    if (bare) return workspace
    return (
        <AppShell workspaceId={workspaceId} projectId={projectId}>
            {workspace}
        </AppShell>
    )
}
