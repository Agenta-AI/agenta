import {useEffect, useMemo} from "react"

import {useAgentConversation} from "@agenta/chat/hooks"
import {getPendingApprovals} from "@agenta/chat/model"
import {Button} from "@agenta/ui/ui"

import {ContentRail} from "@/components/ContentRail"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {StatusTag} from "@/components/StatusTag"

import {AppShell} from "../nav/AppShell"

import {ApprovalDock} from "./ApprovalDock"
import {ChatHeader} from "./ChatHeader"
import {Composer} from "./Composer"
import {ChatLoading} from "./states/ChatStates"
import {StopButton} from "./StopButton"
import {TurnRow} from "./TurnRow"
import {TurnStatusLine} from "./TurnStatusLine"
import {useApprovalActions, type ApprovalActions} from "./useApprovalActions"
import {useSessionWatch} from "./useSessionWatch"
import {useTranscriptAutoScroll} from "./useTranscriptAutoScroll"

/**
 * The LIVE conversation screen — the same engine the desktop chat runs on
 * (`useAgentConversation`: transport, streaming, hydration from records, localStorage cache,
 * queue, approvals, persistence), with mobile's skin: TurnRow transcript, the bottom approval
 * dock, and the pinned composer. Mount with `key={sessionId}`.
 *
 * Approvals route through the ENGINE (approve/deny ride the stream transport and auto-resume,
 * for live and restored gates alike — desktop parity). Steer (deny + redirect note) keeps
 * mobile's detached resume path; after it fires, the records change and the watch relay's
 * `revalidate()` folds the resumed turn in.
 */
export const LiveConversation = ({
    entityId,
    sessionId,
    projectId,
    workspaceId,
    running,
}: {
    entityId: string
    sessionId: string
    projectId: string
    workspaceId: string
    /** Backend liveness (cross-device) — shows the running strip even when this device idles. */
    running: boolean
}) => {
    const conversation = useAgentConversation({entityId, sessionId})

    // Push-invalidation: a records change (another device's turn, a steer resume) folds into
    // the engine's transcript under its adopt guards.
    const watch = useSessionWatch({sessionId, projectId, onRecordsChanged: conversation.revalidate})
    // The watch relay is the primary cross-device signal; when it cannot connect, fall back to a
    // slow revalidate poll only while the backend says the session is running elsewhere.
    useEffect(() => {
        if (watch.connected || !running) return
        const timer = setInterval(() => conversation.revalidate(), 7_500)
        return () => clearInterval(timer)
    }, [watch.connected, running, conversation.revalidate])

    // The engine's own dock latches the shown set; the mobile dock renders the raw pending list
    // (same source function, same index-0 ordering) and acts through the engine.
    const pendingApprovals = useMemo(
        () => getPendingApprovals(conversation.messages),
        [conversation.messages],
    )
    // Steer keeps the detached resume dispatcher; plain approve/deny go through the engine.
    const steerActions = useApprovalActions({
        sessionId,
        projectId,
        pendingApprovalIds: useMemo(
            () => pendingApprovals.map((approval) => approval.approvalId),
            [pendingApprovals],
        ),
    })
    const approvalActions: ApprovalActions = useMemo(
        () => ({
            phase: conversation.approvals.responding ? "resuming" : steerActions.phase,
            errorText: steerActions.errorText,
            respond: ({approved, message, approvalId}) => {
                if (message) {
                    steerActions.respond({approvalId, approved, message})
                    return
                }
                conversation.approvals.respond(approved)
            },
            approveAll: () => conversation.approvals.approveAll(),
        }),
        [conversation.approvals, steerActions],
    )

    const visibleTurns = conversation.turns.filter((turn) => !turn.hidden)
    const autoScroll = useTranscriptAutoScroll(visibleTurns)

    const streamingHere = conversation.status === "submitted" || conversation.status === "streaming"

    let body
    if (conversation.isHydrating) {
        body = <ChatLoading />
    } else {
        body = (
            <ContentRail className="flex grow flex-col gap-3 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                {conversation.historyUnavailable && conversation.isEmpty ? (
                    <p className="text-muted-foreground grow p-6 text-xs">
                        No messages here — this session has no replayable history. New messages
                        still work.
                    </p>
                ) : null}
                {visibleTurns.map((turn) => (
                    <TurnRow key={turn.message.id} turn={turn} />
                ))}
                <TurnStatusLine
                    working={streamingHere || running}
                    waitingForInput={pendingApprovals.length > 0}
                />
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
                        />
                        {running || streamingHere ? (
                            <div className="border-border shrink-0 border-b px-4 py-2">
                                <ContentRail className="flex items-center justify-between">
                                    <StatusTag tone="running" dot>
                                        running
                                    </StatusTag>
                                    {streamingHere ? (
                                        <Button
                                            variant="outline"
                                            className="min-h-8"
                                            onClick={conversation.stop}
                                        >
                                            Stop
                                        </Button>
                                    ) : (
                                        <StopButton sessionId={sessionId} projectId={projectId} />
                                    )}
                                </ContentRail>
                            </div>
                        ) : null}
                    </>
                }
                footer={
                    <div>
                        {pendingApprovals.length > 0 ? (
                            <ApprovalDock
                                approvals={pendingApprovals}
                                actions={approvalActions}
                                entityId={entityId}
                                bottomMost={false}
                            />
                        ) : null}
                        <Composer
                            sessionId={sessionId}
                            onSend={({text, parts}) => conversation.send({text, parts})}
                            disabled={conversation.isHydrating}
                            waitingOnUser={pendingApprovals.length > 0}
                            streaming={streamingHere}
                            onStop={conversation.stop}
                        />
                    </div>
                }
            >
                {body}
            </ScreenScaffold>
        </AppShell>
    )
}
