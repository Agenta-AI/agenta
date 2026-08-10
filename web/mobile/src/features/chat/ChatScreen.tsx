import {useMemo, useState} from "react"

import {
    buildTurnViewModels,
    createExecutedToolIdentityCache,
    getPendingApprovals,
} from "@agenta/chat/model"

import {ContentRail} from "@/components/ContentRail"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {StatusTag} from "@/components/StatusTag"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {useLivenessPoll} from "../sessions/useLivenessPoll"

import {ApprovalDock} from "./ApprovalDock"
import {ChatHeader} from "./ChatHeader"
import {LiveConversation} from "./LiveConversation"
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
 * the shared conversation engine with sending, streaming, and engine-routed approvals. For a
 * session with no turns (nothing to invoke) — or one whose agent lookup fails — the read-only
 * replay below keeps working exactly as before.
 *
 * WHILE the lookup is in flight neither answer is known, so neither screen mounts: committing to
 * the replay would tell the user a session with a perfectly good agent is read-only, and then
 * throw its transcript away when the resolution landed.
 */
export const ChatScreen = ({
    sessionId,
    projectId,
    workspaceId,
}: {
    sessionId: string
    projectId: string
    workspaceId: string
}) => {
    // Every @agenta/* entity query gates on the shared session+project atoms; without this a
    // DIRECT load of a session URL leaves the workflow molecule disabled — the engine still
    // sends (the server uses the saved config), but config-derived UI (always-allow) never
    // qualifies. Home/Sessions bind it too; chat must not depend on having visited them.
    useBindProjectContext(projectId)
    const {entityId, resolving} = useAgentEntity(sessionId, projectId)
    const liveness = useLivenessPoll(projectId)
    const running = Boolean(
        liveness.data?.find((s) => s.session_id === sessionId)?.flags?.is_running,
    )

    // `resolving` is query-PENDING, not fetching: a cached answer renders immediately and a
    // background refetch never flips the screen back to loading. Both queries are enabled
    // unconditionally here (the page guards the params), so this always settles.
    if (resolving) {
        return (
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <ChatHeader
                            sessionId={sessionId}
                            projectId={projectId}
                            workspaceId={workspaceId}
                        />
                    }
                >
                    <ChatLoading />
                </ScreenScaffold>
            </AppShell>
        )
    }

    if (entityId) {
        return (
            <LiveConversation
                key={entityId}
                entityId={entityId}
                sessionId={sessionId}
                projectId={projectId}
                workspaceId={workspaceId}
                running={running}
            />
        )
    }
    return (
        <ReplayScreen
            sessionId={sessionId}
            projectId={projectId}
            workspaceId={workspaceId}
            running={running}
        />
    )
}

/** The original read-only replay (records poll + watch relay + detached approvals). */
const ReplayScreen = ({
    sessionId,
    projectId,
    workspaceId,
    running,
}: {
    sessionId: string
    projectId: string
    workspaceId: string
    running: boolean
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
    // One identity cache per session mount (the screen is keyed by sessionId).

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
                        <TurnRow key={turn.message.id} turn={turn} />
                    ))}
                <TurnStatusLine working={running} waitingForInput={pendingCount > 0} />
            </ContentRail>
        )
    }

    return (
        <AppShell workspaceId={workspaceId} projectId={projectId}>
            <ScreenScaffold
                scrollRef={autoScroll.ref}
                onScroll={autoScroll.onScroll}
                header={
                    <>
                        <ChatHeader
                            sessionId={sessionId}
                            projectId={projectId}
                            workspaceId={workspaceId}
                            subtitle="Read-only — this session has no agent to message yet."
                        />
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
        </AppShell>
    )
}
