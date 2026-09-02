import {useMemo, useRef, useState} from "react"

import {
    buildTurnViewModels,
    createExecutedToolIdentityCache,
    getPendingApprovals,
} from "@agenta/chat/model"
import {ChatJumpToLatest} from "@agenta/ui/components/presentational"
import {useAtomValue} from "jotai"

import {ContentRail} from "@/components/ContentRail"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {StatusTag} from "@/components/StatusTag"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {useLivenessPoll} from "../sessions/useLivenessPoll"

import {ApprovalDock} from "./ApprovalDock"
import {conversationKey} from "./conversationKey"
import {LiveConversation} from "./LiveConversation"
import {selectedRevisionAtomFamily} from "./selectedRevision"
import {SessionWorkspace} from "./SessionWorkspace"
import {ChatEmpty, ChatLoading} from "./states/ChatStates"
import {StopButton} from "./StopButton"
import {TurnRow} from "./TurnRow"
import {TurnStatusLine} from "./TurnStatusLine"
import {useAgentEntity} from "./useAgentEntity"
import {useApprovalActions} from "./useApprovalActions"
import {useSessionTranscript} from "./useSessionTranscript"
import {useSessionWatch} from "./useSessionWatch"
import {useTranscriptAutoScroll} from "./useTranscriptAutoScroll"
import {watchAwarePollMs} from "./watchRelay"

/**
 * The chat screen router — mount it with `key={sessionId}` so per-session state resets.
 *
 * Once the session's agent resolves (owning workflow → latest revision), the LIVE screen mounts:
 * the shared conversation engine with sending, streaming, and engine-routed approvals. Until it
 * resolves — or for a session with no turns (nothing to invoke) — the read-only replay below
 * keeps working exactly as before.
 */
export const ChatScreen = ({
    sessionId,
    projectId,
    workspaceId,
    agentId,
}: {
    sessionId: string
    projectId: string
    workspaceId: string
    /** Route-supplied agent for a session with no turns yet (started from Home's composer). */
    agentId?: string
}) => {
    // Every @agenta/* entity query gates on the shared session+project atoms; without this a
    // DIRECT load of a session URL leaves the workflow molecule disabled — the engine still
    // sends (the server uses the saved config), but config-derived UI (always-allow) never
    // qualifies. Home/Sessions bind it too; chat must not depend on having visited them.
    useBindProjectContext(projectId)
    const {
        entityId: latestEntityId,
        agentId: resolvedAgentId,
        resolving,
    } = useAgentEntity(sessionId, projectId, agentId)
    // A revision picked in the top bar pins the workspace to it — config AND the conversation's
    // invocation target, as on the desktop. Unpinned, the agent's latest is what runs.
    const pinnedRevisionId = useAtomValue(selectedRevisionAtomFamily(sessionId))
    const entityId = pinnedRevisionId ?? latestEntityId
    // Switching sessions re-runs the agent query, and for the moment it is pending `entityId` is
    // null and `resolving` is true. Blanking on that turned every switch into a teardown: the
    // config pane unmounted, the chat became a spinner, and the workspace visibly rebuilt to
    // change which transcript is on screen. Hold the last resolved revision across the gap so the
    // frame stays put; the transcript itself is keyed by sessionId and swaps immediately.
    const lastEntityIdRef = useRef<string | null>(null)
    if (entityId) lastEntityIdRef.current = entityId
    const heldEntityId = entityId ?? lastEntityIdRef.current
    // Only a FIRST load has nothing to hold — that is the one time a spinner is honest.
    const showLoading = resolving && !heldEntityId
    const liveness = useLivenessPoll(projectId)
    const running = Boolean(
        liveness.data?.find((s) => s.session_id === sessionId)?.flags?.is_running,
    )
    // The conversation is ALWAYS mounted — the mode only decides what sits beside it (and, on a
    // narrow frame, which of the two is on screen). Unmounting it on a mode flip would drop a
    // streaming turn.
    // Until the agent query settles, `entityId` is null for an agent-backed session too — so
    // committing to the replay branch here would tell the user the session is read-only when it
    // is not. `resolving` is query-PENDING, not fetching: a cached answer renders immediately.
    const chat = showLoading ? (
        <ChatLoading />
    ) : heldEntityId ? (
        <LiveConversation
            // Per SESSION only — see `conversationKey`. Keying it here and not the page keeps the
            // shell, the split and the config pane mounted while the transcript is rebuilt.
            key={conversationKey({sessionId, revisionId: heldEntityId})}
            embedded
            entityId={heldEntityId}
            sessionId={sessionId}
            projectId={projectId}
            workspaceId={workspaceId}
            running={running}
            agentId={resolvedAgentId}
        />
    ) : (
        <ReplayScreen
            embedded
            sessionId={sessionId}
            projectId={projectId}
            workspaceId={workspaceId}
            running={running}
            agentId={resolvedAgentId}
        />
    )

    return (
        <SessionWorkspace
            // Held, not raw: the config pane keys off this, and letting it blink to null mid-switch
            // is what unmounted the pane.
            entityId={heldEntityId}
            agentId={resolvedAgentId}
            sessionId={sessionId}
            workspaceId={workspaceId}
            projectId={projectId}
            chat={chat}
        />
    )
}

/** The original read-only replay (records poll + watch relay + detached approvals). */
const ReplayScreen = ({
    sessionId,
    projectId,
    workspaceId,
    running,
    agentId,
    embedded = false,
}: {
    sessionId: string
    projectId: string
    workspaceId: string
    running: boolean
    /** Scopes the session tab rail to this agent's sessions. */
    agentId?: string | null
    /** Rendered inside a workspace pane — the shell belongs to the parent. */
    embedded?: boolean
}) => {
    // Tightened records cadence only while this foregrounded screen shows a running or pending
    // turn; derived from the previous render's messages, so it settles one render behind.
    const [pollMs, setPollMs] = useState(0)
    const {messages, state, refresh} = useSessionTranscript(sessionId, pollMs)
    // Live relay (M3): push-invalidate through the same tick body; while it is open the
    // poll below is only a safety net.
    const watch = useSessionWatch({sessionId, projectId, onRecordsChanged: refresh})
    const pendingApprovals = useMemo(() => getPendingApprovals(messages), [messages])
    const pendingCount = pendingApprovals.length
    const pendingApprovalIds = useMemo(
        () => pendingApprovals.map((approval) => approval.approvalId),
        [pendingApprovals],
    )
    const approvals = useApprovalActions({sessionId, projectId, pendingApprovalIds})
    // ~4s while a fired decision settles (fire-and-forget — records carry the resume).
    const basePollMs =
        approvals.phase === "resuming" ? 4_000 : pendingCount > 0 || running ? 7_500 : 0
    const nextPollMs = watchAwarePollMs(basePollMs, watch.connected)
    if (nextPollMs !== pollMs) setPollMs(nextPollMs)
    // One identity cache per session — the dep does that, and must, since the screen is no longer
    // remounted per session.

    const executedFor = useMemo(() => createExecutedToolIdentityCache(), [sessionId])
    const turns = useMemo(
        () => buildTurnViewModels(messages, {busy: false, executedFor}),
        [messages, executedFor],
    )
    // Keyed on `turns` (new array per poll) so streamed growth also re-pins.
    const autoScroll = useTranscriptAutoScroll(turns)

    let body
    if (state === "loading") {
        body = <ChatLoading />
    } else if (state === "empty") {
        body = <ChatEmpty />
    } else {
        body = (
            <ContentRail className="flex grow flex-col gap-3 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                {turns
                    .filter((turn) => !turn.hidden)
                    .map((turn) => (
                        <TurnRow
                            workflowId={agentId}
                            key={turn.message.id}
                            turn={turn}
                            sessionId={sessionId}
                        />
                    ))}
                <TurnStatusLine working={running} waitingForInput={pendingCount > 0} />
            </ContentRail>
        )
    }

    const scaffold = (
        <ScreenScaffold
            scrollRef={autoScroll.ref}
            onScroll={autoScroll.onScroll}
            scrollOverlay={
                <ChatJumpToLatest show={autoScroll.showJump} onClick={autoScroll.jumpToLatest} />
            }
            embedded={embedded}
            header={
                <>
                    {/* Why there is no composer. The session may still name an agent (the link
                        carries it) and only be missing a revision — don't claim it has none. */}
                    <p className="text-muted-foreground border-colorBorderSecondary m-0 shrink-0 border-x-0 border-t-0 border-b border-solid px-4 py-1.5 text-xs">
                        {agentId
                            ? "Read-only — this agent has no revision to message yet."
                            : "Read-only — this session has no agent to message yet."}
                    </p>
                    {running ? (
                        <div className="border-border shrink-0 border-b px-4 py-2">
                            <ContentRail className="flex items-center justify-between">
                                <StatusTag tone="running" dot>
                                    running
                                </StatusTag>
                                <StopButton sessionId={sessionId} projectId={projectId} />
                            </ContentRail>
                        </div>
                    ) : null}
                </>
            }
            // Only a rendering dock counts as a footer — it owns the safe-area inset, and
            // ApprovalDock renders nothing when no gate is pending.
            footer={
                pendingApprovals.length > 0 ? (
                    <ApprovalDock approvals={pendingApprovals} actions={approvals} />
                ) : undefined
            }
        >
            {body}
        </ScreenScaffold>
    )

    return embedded ? (
        scaffold
    ) : (
        <AppShell workspaceId={workspaceId} projectId={projectId}>
            {scaffold}
        </AppShell>
    )
}
