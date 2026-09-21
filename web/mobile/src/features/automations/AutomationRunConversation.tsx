import {AutomationRunConversationUnavailable} from "@agenta/automation-ui"
import dynamic from "next/dynamic"

import {conversationKey} from "../chat/conversationKey"
import {LiveConversation} from "../chat/LiveConversation"
import {ChatLoading} from "../chat/states/ChatStates"
import {useAgentEntity} from "../chat/useAgentEntity"
import {useLivenessPoll} from "../sessions/useLivenessPoll"

// The tool catalog is opened by setting an atom, so whoever opens it needs this mounted or the
// action does nothing. An automation's run is answerable, and the agent's own connect widget
// opens the catalog from the transcript — which is here, not in the session workspace that
// carries the other mount. Without it a Connect request parks the turn on a drawer that never
// appears, and nothing settles the tool call.
const CatalogDrawer = dynamic(
    () => import("@agenta/entity-ui/gatewayTool").then((m) => m.CatalogDrawer),
    {ssr: false},
)

/**
 * The run's session, as the chat screen already draws it.
 *
 * A MOUNT, not a rebuild: `LiveConversation` is the app's conversation surface, and it carries
 * the real composer, attachments, drafts and slash commands. Hand-rendering bubbles here would
 * produce a transcript that looks like chat and cannot be replied to — an automation's run is a
 * session like any other, and it is answerable.
 *
 * Split out from the pane so the hooks below only ever run for a run that HAS a session; a
 * delivery with no transcript never enters this component (see `runSessionId`).
 */
export const AutomationRunConversation = ({
    sessionId,
    projectId,
    workspaceId,
    agentId,
}: {
    sessionId: string
    projectId: string
    workspaceId: string
    /** The automation's bound agent — the run's own session may have no turns to name one. */
    agentId: string | null
}) => {
    const {
        entityId,
        agentId: resolvedAgentId,
        resolving,
    } = useAgentEntity(sessionId, projectId, agentId)
    // The same five liveness facts the chat screen threads in, off the same project poll — a
    // run that is still going streams here exactly as it does in the session list.
    const liveness = useLivenessPoll(projectId)
    const liveStream = liveness.data?.find((stream) => stream.session_id === sessionId)
    const running = Boolean(liveStream?.flags?.is_running)
    const sharedReader = Boolean(liveStream?.capabilities?.shared_reader)

    if (!entityId) {
        return resolving ? <ChatLoading /> : <AutomationRunConversationUnavailable />
    }

    return (
        <>
            <LiveConversation
                // Per session — the pane swaps transcripts as runs are picked, and the engine's
                // per-session state must not survive that swap.
                key={conversationKey({sessionId, revisionId: entityId})}
                embedded
                entityId={entityId}
                sessionId={sessionId}
                projectId={projectId}
                workspaceId={workspaceId}
                agentId={resolvedAgentId}
                running={running}
                stopStateLoading={liveness.isLoading}
                sessionTurnId={liveStream?.turn_id}
                stoppingTurnId={liveStream?.stopping_turn_id}
                sharedReader={sharedReader}
            />
            <CatalogDrawer />
        </>
    )
}
