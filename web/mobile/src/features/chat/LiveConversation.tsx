import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    BOTTOM_FADE_HOVER_HIDE,
    BOTTOM_FADE_OVERLAY_STYLE,
    EDGE_FADE_MASK,
    jumpGateOpen,
    shouldShowStopControl,
} from "@agenta/chat/assets"
import {
    ConnectionDock,
    ElicitationDock,
    ConnectionFocusProvider,
    QueuedMessagesDock,
    RunningElsewhereStrip,
} from "@agenta/chat/components"
import type {QueuedMessage} from "@agenta/chat/hooks"
import {
    useAgentConversation,
    useAgentModelKeyStatus,
    useConnectionDock,
    useElicitationDock,
} from "@agenta/chat/hooks"
import {getLivePendingApprovals, type TurnViewModel} from "@agenta/chat/model"
import {getSessionTurnId} from "@agenta/chat/state"
import {cancelSessionStream} from "@agenta/entities/session"
import {AgentIntroCard} from "@agenta/entity-ui/agent"
import {message, modal} from "@agenta/ui/app-message"
import {
    ChatBubble,
    ChatBubbleAvatar,
    ChatJumpToLatest,
    turnRowClass,
} from "@agenta/ui/components/presentational"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {useAtomValue, useSetAtom} from "jotai"
import {User} from "lucide-react"

import {ContentRail} from "@/components/ContentRail"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {pendingTasksAtom, takePendingTaskAtom} from "../home/pendingTask"
import {AppShell} from "../nav/AppShell"

import {ApprovalDock} from "./ApprovalDock"
import {Composer} from "./Composer"
import {ConnectModelStrip} from "./ConnectModelStrip"
import {
    MODEL_KEY_WAIT_LIMIT_MS,
    PENDING_TASK_NOT_SENT_MESSAGE,
    pendingTaskDecision,
} from "./pendingTaskPolicy"
import {ChatLoading} from "./states/ChatStates"
import {StopButton} from "./StopButton"
import {cancelledStopAction} from "./stopHereState"
import {TurnRow} from "./TurnRow"
import {showTrailingWorkingPulse} from "./turnStatus"
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
    agentId,
    embedded = false,
}: {
    entityId: string
    sessionId: string
    projectId: string
    workspaceId: string
    /** Backend liveness (cross-device) — shows the running strip even when this device idles. */
    running: boolean
    /** Scopes the session tab rail to this agent's sessions. */
    agentId?: string | null
    /** Rendered inside a workspace pane — the shell and its rail belong to the parent. */
    embedded?: boolean
}) => {
    const conversation = useAgentConversation({entityId, sessionId})

    // The connect-model gate — desktop parity. The engine deliberately leaves this to the skin
    // (`useAgentConversation` says so): a keyless project must be told to add a key BEFORE the
    // send, not shown a raw 422 after it. Blocks the composer, holds the parked task, and raises
    // the strip below.
    const modelKey = useAgentModelKeyStatus(entityId)
    const modelBlocked = modelKey.gateActive
    // The strip stays hidden until the vault answers (`gateActive` is false while it loads), but
    // the parked task must NOT go out on that same unknown — see `pendingTaskPolicy`.
    const modelKeyLoading = modelKey.loading

    // The vault wait is bounded (`pendingTaskPolicy`). This stays 0 while the wait is on and
    // becomes the elapsed time when the deadline fires, which is the render that releases the task.
    const modelKeyWaitStartRef = useRef<number | null>(null)
    const [modelKeyWaitedMs, setModelKeyWaitedMs] = useState(0)
    useEffect(() => {
        if (!modelKeyLoading) {
            modelKeyWaitStartRef.current = null
            setModelKeyWaitedMs(0)
            return
        }
        const startedAt = modelKeyWaitStartRef.current ?? Date.now()
        modelKeyWaitStartRef.current = startedAt
        const remaining = Math.max(0, MODEL_KEY_WAIT_LIMIT_MS - (Date.now() - startedAt))
        const timer = setTimeout(() => setModelKeyWaitedMs(Date.now() - startedAt), remaining)
        return () => clearTimeout(timer)
    }, [modelKeyLoading])

    // The composer's input handle. Declared here because the released task puts its text back in
    // the composer, and rewind (far below) refills it the same way.
    const composerRef = useRef<RichChatInputHandle | null>(null)

    // Editing borrows the composer: the row's text goes in, the draft it displaces is stashed.
    const {beginEdit, cancelEdit} = conversation
    const editQueued = useCallback(
        (message: QueuedMessage) => {
            const input = composerRef.current
            beginEdit(message.id, input?.getMarkdown() ?? "")
            input?.setMarkdown(message.text)
            input?.focus()
        },
        [beginEdit],
    )
    const cancelQueuedEdit = useCallback(() => {
        const input = composerRef.current
        input?.setMarkdown(cancelEdit())
        input?.focus()
    }, [cancelEdit])

    // A task started from Home lands here as a stashed message: the session did not exist when
    // it was typed, and the first send is what creates it. Ref-guarded and the slot is consumed
    // on read, so a re-render (or React 18's double-invoke in dev) cannot send it twice. Held
    // until hydration settles, or the engine would send into a transcript it is still filling,
    // and held while the vault is unresolved or the model gate is up, so the first message is not
    // spent on a run that cannot succeed — it goes out on its own the moment a key lands (or the
    // vault says one already exists). The guard holds the SESSION it
    // fired for, not a bare flag: this component survives a session switch, and a flag would
    // swallow the next session's stashed task.

    // Peek at the parked task WITHOUT consuming it — used only for display while the gate holds.
    // `takePendingTaskAtom` removes the entry; this read leaves it in place for the send effect.
    const pendingTasks = useAtomValue(pendingTasksAtom)
    const heldTaskText = pendingTasks[sessionId]?.text ?? null

    const takePendingTask = useSetAtom(takePendingTaskAtom)
    const sentPendingTaskFor = useRef<string | null>(null)
    const [pendingTaskError, setPendingTaskError] = useState<string | null>(null)
    const {isHydrating, revalidate, send, stop} = conversation
    useEffect(() => {
        const decision = pendingTaskDecision({
            sessionId,
            sentFor: sentPendingTaskFor.current,
            hydrating: isHydrating,
            modelKeyLoading,
            modelKeyWaitedMs,
            modelBlocked,
        })
        if (decision === "hold") return
        const task = takePendingTask(sessionId)
        if (!task) return
        // Consumed either way — a released task must not replay on the next render.
        sentPendingTaskFor.current = sessionId
        if (decision === "abandon") {
            setPendingTaskError(PENDING_TASK_NOT_SENT_MESSAGE)
            // Hand the text back so "try again" is one tap. The composer is usable here: the gate
            // is not up, because an unresolved vault never raises it.
            if (task.text) composerRef.current?.setMarkdown(task.text)
            return
        }
        void send({text: task.text, parts: task.parts})
    }, [
        isHydrating,
        modelKeyLoading,
        modelKeyWaitedMs,
        modelBlocked,
        send,
        sessionId,
        takePendingTask,
    ])

    const streamingHere = conversation.status === "submitted" || conversation.status === "streaming"
    const streamingHereRef = useRef(streamingHere)
    streamingHereRef.current = streamingHere
    const [stoppingHere, setStoppingHere] = useState(false)
    const stopWatchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const expectedStopExecutionIdRef = useRef<string | undefined>(undefined)
    const retryStopRef = useRef(false)
    const stopSessionIdRef = useRef(sessionId)
    stopSessionIdRef.current = sessionId
    const settleParkedStop = useCallback(() => {
        if (stopWatchdogTimerRef.current) clearTimeout(stopWatchdogTimerRef.current)
        stopWatchdogTimerRef.current = null
        retryStopRef.current = false
        expectedStopExecutionIdRef.current = undefined
        // Server acceptance makes the local stop a render-only latch.
        stop()
        setStoppingHere(false)
    }, [stop])

    useEffect(() => {
        if (stopWatchdogTimerRef.current) clearTimeout(stopWatchdogTimerRef.current)
        stopWatchdogTimerRef.current = null
        retryStopRef.current = false
        expectedStopExecutionIdRef.current = undefined
        setStoppingHere(false)
    }, [sessionId])

    // Push invalidation folds cross-device changes into the guarded transcript.
    const watch = useSessionWatch({
        sessionId,
        projectId,
        onRecordsChanged: revalidate,
    })
    // Poll slowly while a cross-device run cannot be watched live.
    useEffect(() => {
        if (watch.connected || !running) return
        const timer = setInterval(() => revalidate(), 7_500)
        return () => clearInterval(timer)
    }, [watch.connected, running, revalidate])
    useEffect(() => {
        if (streamingHere || !stopWatchdogTimerRef.current) return
        clearTimeout(stopWatchdogTimerRef.current)
        stopWatchdogTimerRef.current = null
        retryStopRef.current = false
        expectedStopExecutionIdRef.current = undefined
        setStoppingHere(false)
    }, [streamingHere])
    useEffect(
        () => () => {
            if (stopWatchdogTimerRef.current) clearTimeout(stopWatchdogTimerRef.current)
        },
        [],
    )

    // Composer Stop cancels on the server before changing local presentation.
    const stopHere = useCallback(() => {
        if (stoppingHere) return
        if (!projectId || !sessionId) return
        setStoppingHere(true)
        const wasParked = !streamingHereRef.current && conversation.hitlPending
        const isRetry = retryStopRef.current
        const expectedExecutionId = isRetry
            ? expectedStopExecutionIdRef.current
            : getSessionTurnId(sessionId)
        retryStopRef.current = false
        expectedStopExecutionIdRef.current = expectedExecutionId
        // Missing execution ids select the server's arrival-time guard.
        void cancelSessionStream({
            sessionId,
            projectId,
            expectedExecutionId,
        })
            .then((outcome) => {
                if (stopSessionIdRef.current !== sessionId) return
                if (outcome.status === "cancelled") {
                    const action = cancelledStopAction({
                        parked: wasParked,
                        streaming: streamingHereRef.current,
                        retry: isRetry,
                    })
                    if (action === "settle-parked") {
                        settleParkedStop()
                        return
                    }
                    if (action === "settle-idle") {
                        setStoppingHere(false)
                        expectedStopExecutionIdRef.current = undefined
                        return
                    }
                    if (action === "abort-retry") {
                        stop()
                        setStoppingHere(false)
                        expectedStopExecutionIdRef.current = undefined
                        return
                    }
                    stopWatchdogTimerRef.current = setTimeout(() => {
                        retryStopRef.current = true
                        stopWatchdogTimerRef.current = null
                        setStoppingHere(false)
                    }, 30_000)
                    return
                }
                if (isRetry) retryStopRef.current = true
                setStoppingHere(false)
                if (outcome.status === "idle") {
                    retryStopRef.current = false
                    expectedStopExecutionIdRef.current = undefined
                    return
                }
                message.warning(outcome.message)
            })
            .catch((error: unknown) => {
                if (stopSessionIdRef.current !== sessionId) return
                if (isRetry) retryStopRef.current = true
                setStoppingHere(false)
                message.warning(
                    error instanceof Error
                        ? error.message
                        : "Could not stop the run. It may still be running.",
                )
            })
    }, [projectId, sessionId, stop, stoppingHere, conversation.hitlPending, settleParkedStop])

    // A stopped turn has no live approval actions.
    const pendingApprovals = useMemo(
        () => getLivePendingApprovals(conversation.messages, {stopped: conversation.stopped}),
        [conversation.messages, conversation.stopped],
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

    // The auto-scroll effect keys on IDENTITY, so a fresh array every render would re-pin the
    // transcript on renders that changed nothing about it (a watch reconnect, a steer phase).
    // Memoized, it re-pins exactly when the turns actually change.
    const visibleTurns = useMemo(
        () => conversation.turns.filter((turn) => !turn.hidden),
        [conversation.turns],
    )
    const autoScroll = useTranscriptAutoScroll(visibleTurns)

    // Parked connect interactions → the dock above the composer owns their actions, so a paused
    // run can't scroll out of reach. Gated the same way desktop gates it.
    // Parked question forms → the docked card owns the questions and the answers; the transcript
    // rows are passive markers.
    const elicits = useElicitationDock({
        messages: conversation.messages,
        enabled: !streamingHere && !conversation.stopped,
        approvalsPending: pendingApprovals.length > 0,
        onOutput: conversation.sendToolOutput,
    })
    const connects = useConnectionDock({
        messages: conversation.messages,
        enabled: !streamingHere && !conversation.stopped,
        approvalsPending: pendingApprovals.length > 0,
        elicitationPending: elicits.open,
    })
    // Any blocking dock on screen. The queue card yields to all of them rather than stacking,
    // mid-edit included — the composer keeps the edit, so Enter still rewrites the held row.
    const gateDockOpen = pendingApprovals.length > 0 || elicits.open || connects.open
    // A docked gate holds the jump pill back — same rule, same reasons, as the desktop. This
    // surface has no question-form dock yet, so only approvals and connect cards can gate it.
    const gateOpen = jumpGateOpen({
        approvals: pendingApprovals.length,
        elicitationOpen: false,
        connectionOpen: connects.open,
    })

    // Rewind: re-run the conversation from a turn. The hook only SCANS (it never opens dialogs),
    // so the warning about tools that already ran, and putting a rewound user message back into
    // the composer, are this surface's job — same division the desktop uses. `composerRef` is
    // declared above, with the parked task that also refills the input.
    const handleRewind = useCallback(
        (turn: TurnViewModel) => {
            const plan = conversation.rewind(turn.message)
            if (!plan) return
            const run = () => {
                plan.confirm()
                if (plan.restoreText === undefined) return
                composerRef.current?.setMarkdown(plan.restoreText)
                requestAnimationFrame(() => composerRef.current?.focus())
            }
            if (plan.sideEffects.length === 0) {
                run()
                return
            }
            modal.confirm({
                title: "Rewind past a tool that already ran?",
                content: `${plan.sideEffects.join(", ")} already executed. Rewinding re-runs the conversation from here but will NOT undo it.`,
                okText: "Rewind anyway",
                okButtonProps: {danger: true},
                cancelText: "Cancel",
                centered: true,
                onOk: run,
            })
        },
        [conversation],
    )

    let body
    if (conversation.isHydrating) {
        body = <ChatLoading />
    } else {
        body = (
            <ContentRail className="flex grow flex-col gap-3 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                {/* A task typed before any provider key exists is held in `pendingTasksAtom`
                    (not yet sent — the gate is up). Render it as a user bubble so the person
                    can see what they wrote, matching desktop parity: the desktop shows the
                    held seed above the connect-model banner. Cleared the moment the gate
                    drops and the send effect fires (`takePendingTaskAtom` removes the entry). */}
                {heldTaskText ? (
                    <div className={`${turnRowClass} justify-end`}>
                        <ChatBubble
                            placement="end"
                            variant="filled"
                            avatar={<ChatBubbleAvatar icon={<User className="size-4" />} />}
                            className="min-w-0 max-w-[85%]"
                            classNames={{
                                content: "min-w-0 max-w-full overflow-hidden text-xs",
                                body: "min-w-0 max-w-full overflow-hidden",
                            }}
                            content={
                                <span className="whitespace-pre-wrap break-words">
                                    {heldTaskText}
                                </span>
                            }
                        />
                    </div>
                ) : null}
                {conversation.isEmpty ? (
                    // The SAME card the desktop shows a conversation with no messages: who you are
                    // about to talk to. A blank session is not an error state — /m rendered nothing
                    // here, and for a freshly minted one it claimed the history was unavailable,
                    // which is a different and much more alarming thing to say.
                    <div className="m-auto w-full max-w-[420px]">
                        <AgentIntroCard entityId={entityId} />
                        {conversation.historyUnavailable ? (
                            <p className="text-muted-foreground mt-3 text-center text-xs">
                                This session&apos;s earlier messages are no longer stored. New
                                messages still work.
                            </p>
                        ) : null}
                    </div>
                ) : null}
                {visibleTurns.map((turn) => (
                    <TurnRow
                        workflowId={agentId}
                        key={turn.message.id}
                        turn={turn}
                        onClientToolOutput={conversation.sendToolOutput}
                        onRewind={handleRewind}
                        sessionId={sessionId}
                    />
                ))}
                {/* The working indicator moved into the streaming turn itself, beside its avatar,
                    where the desktop has always had it — as a line after the whole list it floated
                    far below the turn it described. It falls back to here for the one case that
                    turn cannot cover: the request is submitted and no assistant turn exists yet. */}
                <TurnStatusLine
                    working={showTrailingWorkingPulse(streamingHere, visibleTurns)}
                    waitingForInput={conversation.hitlPending}
                />
            </ContentRail>
        )
    }

    // Wraps transcript AND dock: a parked "Connect to X below" row taps through to X's card.
    const scaffold = (
        <ConnectionFocusProvider connects={connects}>
            <ScreenScaffold
                scrollRef={autoScroll.ref}
                onScroll={autoScroll.onScroll}
                scrollOverlay={
                    <ChatJumpToLatest
                        show={autoScroll.showJump && !gateOpen}
                        onClick={autoScroll.jumpToLatest}
                    />
                }
                embedded={embedded}
                // The top edge fades as a MASK, exactly as the desktop transcript does — content
                // dissolves under the tab bar instead of being cut by a hard line.
                scrollStyle={{maskImage: EDGE_FADE_MASK, WebkitMaskImage: EDGE_FADE_MASK}}
                footer={
                    <div className="relative">
                        {/* Bottom fade: a sibling overlay, NOT a second mask. A mask on the scroller
                        would fade any hover toolbar that scrolls into the band, and no z-index
                        escapes an ancestor's mask — the desktop learned this the same way. It sits
                        above the footer and is dropped while a turn is hovered. */}
                        <div
                            aria-hidden
                            className={`pointer-events-none absolute inset-x-0 bottom-full ${BOTTOM_FADE_HOVER_HIDE}`}
                            style={BOTTOM_FADE_OVERLAY_STYLE}
                        />
                        {/* What you have lined up. Yields to the gate docks entirely: those are
                        blocked runs wanting an answer, and stacking a second card above one
                        buries the composer. It comes back when the gate clears. */}
                        {conversation.queued.length > 0 && !gateDockOpen ? (
                            <div className="bg-background shrink-0 px-3 pt-3 pb-0">
                                <ContentRail>
                                    <QueuedMessagesDock
                                        queued={conversation.queued}
                                        held={conversation.hitlPending}
                                        onRemove={conversation.removeQueued}
                                        onEdit={editQueued}
                                        onCancelEdit={cancelQueuedEdit}
                                        editingId={conversation.editingId}
                                        touch
                                    />
                                </ContentRail>
                            </div>
                        ) : null}
                        {/* A run this device is not driving. Docked with the other strips above the
                        composer, as on the desktop — it used to be a top bar that also appeared for
                        THIS device's own turns, duplicating the composer's Stop and shifting the
                        transcript twice per run. */}
                        {running && !streamingHere ? (
                            <ContentRail>
                                <RunningElsewhereStrip
                                    action={
                                        <StopButton sessionId={sessionId} projectId={projectId} />
                                    }
                                />
                            </ContentRail>
                        ) : null}
                        {pendingApprovals.length > 0 ? (
                            <ApprovalDock
                                approvals={pendingApprovals}
                                actions={approvalActions}
                                entityId={entityId}
                                bottomMost={false}
                            />
                        ) : null}
                        {/* Parked question forms, between approval and connect — the same order as
                        desktop, and the same order as the keyboard precedence. */}
                        {elicits.open ? (
                            <div className="bg-background shrink-0 px-3 pt-3 pb-0">
                                <ContentRail>
                                    <ElicitationDock
                                        elicits={elicits}
                                        onOutput={conversation.sendToolOutput}
                                        touch
                                    />
                                </ContentRail>
                            </div>
                        ) : null}
                        {/* Parked connections. The rail and padding are all this host adds; the dock
                        itself is the shared package component. */}
                        {connects.open ? (
                            <div className="bg-background shrink-0 px-3 pt-3 pb-0">
                                <ContentRail>
                                    <ConnectionDock
                                        connects={connects}
                                        onOutput={conversation.sendToolOutput}
                                        touch
                                    />
                                </ContentRail>
                            </div>
                        ) : null}
                        {/* Docked with the other strips, directly above the composer it disables —
                        the same place the desktop banner sits. */}
                        <ContentRail>
                            <ConnectModelStrip
                                providerEntry={modelKey.providerEntry}
                                gateActive={modelBlocked}
                            />
                        </ContentRail>
                        {/* The parked task gave up waiting for the vault. Its text is back in the
                        composer, so this says what happened and the send is one tap away. */}
                        {pendingTaskError ? (
                            <ContentRail>
                                <p className="text-destructive m-0 mb-2 text-xs">
                                    {pendingTaskError}
                                </p>
                            </ContentRail>
                        ) : null}
                        <Composer
                            sessionId={sessionId}
                            onSend={({text, parts}) => {
                                setStoppingHere(false)
                                // An open edit rewrites its held message instead of sending. The
                                // input clears on submit, so the displaced draft goes back after.
                                if (!conversation.editingId) {
                                    conversation.send({text, parts})
                                    return
                                }
                                const draft = conversation.commitEdit({text, fileParts: parts})
                                if (draft)
                                    requestAnimationFrame(() =>
                                        composerRef.current?.setMarkdown(draft),
                                    )
                            }}
                            disabled={conversation.isHydrating || modelBlocked}
                            placeholder={
                                modelBlocked ? "Connect a model to start chatting…" : undefined
                            }
                            waitingOnUser={conversation.hitlPending}
                            streaming={shouldShowStopControl({
                                busy: streamingHere,
                                hitlPending: conversation.hitlPending,
                            })}
                            stopping={stoppingHere}
                            onStop={stopHere}
                            inputRef={composerRef}
                        />
                    </div>
                }
            >
                {body}
            </ScreenScaffold>
        </ConnectionFocusProvider>
    )

    // Embedded: the workspace owns the shell and the pane geometry.
    return embedded ? (
        scaffold
    ) : (
        <AppShell workspaceId={workspaceId} projectId={projectId}>
            {scaffold}
        </AppShell>
    )
}
