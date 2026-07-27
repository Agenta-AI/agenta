import {useMemo, useState} from "react"

import {
    buildTurnViewModels,
    createExecutedToolIdentityCache,
    getPendingApprovals,
} from "@agenta/chat/model"

import {useLivenessPoll} from "../sessions/useLivenessPoll"

import {ChatHeader} from "./ChatHeader"
import {ChatEmpty, ChatLoading} from "./states/ChatStates"
import {StopButton} from "./StopButton"
import {TurnRow} from "./TurnRow"
import {useApprovalActions} from "./useApprovalActions"
import {useSessionTranscript} from "./useSessionTranscript"

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
    const {messages, state} = useSessionTranscript(sessionId, pollMs)
    const liveness = useLivenessPoll(projectId)
    const running = Boolean(
        liveness.data?.find((s) => s.session_id === sessionId)?.flags?.is_running,
    )
    const pendingCount = useMemo(() => getPendingApprovals(messages).length, [messages])
    const approvals = useApprovalActions({sessionId, projectId, pendingCount})
    // ~4s while a fired decision settles (fire-and-forget — records carry the resume).
    const nextPollMs =
        approvals.phase === "resuming" ? 4_000 : pendingCount > 0 || running ? 7_500 : 0
    if (nextPollMs !== pollMs) setPollMs(nextPollMs)
    // One identity cache per session mount (the screen is keyed by sessionId).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const executedFor = useMemo(() => createExecutedToolIdentityCache(), [sessionId])
    const turns = useMemo(
        () => buildTurnViewModels(messages, {busy: false, executedFor}),
        [messages, executedFor],
    )

    let body
    if (state === "loading") {
        body = <ChatLoading />
    } else if (state === "empty") {
        body = <ChatEmpty />
    } else {
        body = (
            <div className="flex grow flex-col gap-3 p-4">
                {turns
                    .filter((turn) => !turn.hidden)
                    .map((turn) => (
                        <TurnRow
                            key={turn.message.id}
                            turn={turn}
                            approvalActions={approvals}
                            pendingApprovals={pendingCount}
                        />
                    ))}
            </div>
        )
    }

    return (
        <div className="bg-background text-foreground flex min-h-dvh flex-col">
            <ChatHeader sessionId={sessionId} projectId={projectId} workspaceId={workspaceId} />
            {running ? (
                <div className="border-border flex items-center justify-between border-b px-4 py-2">
                    <span className="text-primary text-xs">A turn is running</span>
                    <StopButton sessionId={sessionId} projectId={projectId} />
                </div>
            ) : null}
            {body}
        </div>
    )
}
