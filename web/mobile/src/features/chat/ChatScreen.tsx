import {useMemo, useState} from "react"

import {
    buildTurnViewModels,
    createExecutedToolIdentityCache,
    getPendingApprovals,
} from "@agenta/chat/model"

import {ScreenScaffold} from "@/components/ScreenScaffold"
import {StatusTag} from "@/components/StatusTag"

import {useLivenessPoll} from "../sessions/useLivenessPoll"

import {ApprovalDock} from "./ApprovalDock"
import {ChatHeader} from "./ChatHeader"
import {ChatEmpty, ChatLoading} from "./states/ChatStates"
import {StopButton} from "./StopButton"
import {TurnRow} from "./TurnRow"
import {useApprovalActions} from "./useApprovalActions"
import {useSessionTranscript} from "./useSessionTranscript"
import {useSessionWatch} from "./useSessionWatch"
import {useTranscriptAutoScroll} from "./useTranscriptAutoScroll"
import {watchAwarePollMs} from "./watchRelay"

/** Read-only replay screen — mount it with `key={sessionId}` so per-session state resets. */
export const ChatScreen = ({
    sessionId,
    projectId,
    workspaceId,
}: {
    sessionId: string
    projectId: string
    workspaceId: string
}) => {
    // Tightened records cadence only while this foregrounded screen shows a running or pending
    // turn; derived from the previous render's messages, so it settles one render behind.
    const [pollMs, setPollMs] = useState(0)
    const {messages, state, refresh} = useSessionTranscript(sessionId, pollMs)
    // Live relay (M3): push-invalidate through the same tick body; while it is open the
    // poll below is only a safety net.
    const watch = useSessionWatch({sessionId, projectId, onRecordsChanged: refresh})
    const liveness = useLivenessPoll(projectId)
    const running = Boolean(
        liveness.data?.find((s) => s.session_id === sessionId)?.flags?.is_running,
    )
    const pendingApprovals = useMemo(() => getPendingApprovals(messages), [messages])
    const pendingCount = pendingApprovals.length
    const approvals = useApprovalActions({sessionId, projectId, pendingCount})
    // ~4s while a fired decision settles (fire-and-forget — records carry the resume).
    const basePollMs =
        approvals.phase === "resuming" ? 4_000 : pendingCount > 0 || running ? 7_500 : 0
    const nextPollMs = watchAwarePollMs(basePollMs, watch.connected)
    if (nextPollMs !== pollMs) setPollMs(nextPollMs)
    // One identity cache per session mount (the screen is keyed by sessionId).
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            <div className="flex grow flex-col gap-3 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                {turns
                    .filter((turn) => !turn.hidden)
                    .map((turn) => (
                        <TurnRow key={turn.message.id} turn={turn} />
                    ))}
            </div>
        )
    }

    return (
        <ScreenScaffold
            scrollRef={autoScroll.ref}
            onScroll={autoScroll.onScroll}
            header={
                <>
                    <ChatHeader
                        sessionId={sessionId}
                        projectId={projectId}
                        workspaceId={workspaceId}
                    />
                    {running ? (
                        <div className="border-border flex shrink-0 items-center justify-between border-b px-4 py-2">
                            <StatusTag tone="running" dot>
                                running
                            </StatusTag>
                            <StopButton sessionId={sessionId} projectId={projectId} />
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
}
