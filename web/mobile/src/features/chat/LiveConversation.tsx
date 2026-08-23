import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    BOTTOM_FADE_HOVER_HIDE,
    BOTTOM_FADE_OVERLAY_STYLE,
    EDGE_FADE_MASK,
} from "@agenta/chat/assets"
import {RunningElsewhereStrip} from "@agenta/chat/components"
import {useAgentConversation, useAgentModelKeyStatus} from "@agenta/chat/hooks"
import {getPendingApprovals, type TurnViewModel} from "@agenta/chat/model"
import {AgentIntroCard} from "@agenta/entity-ui/agent"
import {modal} from "@agenta/ui/app-message"
import {ChatJumpToLatest} from "@agenta/ui/components/presentational"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {useSetAtom} from "jotai"

import {ContentRail} from "@/components/ContentRail"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {takePendingTaskAtom} from "../home/pendingTask"
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

    // A task started from Home lands here as a stashed message: the session did not exist when
    // it was typed, and the first send is what creates it. Ref-guarded and the slot is consumed
    // on read, so a re-render (or React 18's double-invoke in dev) cannot send it twice. Held
    // until hydration settles, or the engine would send into a transcript it is still filling,
    // and held while the vault is unresolved or the model gate is up, so the first message is not
    // spent on a run that cannot succeed — it goes out on its own the moment a key lands (or the
    // vault says one already exists). The guard holds the SESSION it
    // fired for, not a bare flag: this component survives a session switch, and a flag would
    // swallow the next session's stashed task.
    const takePendingTask = useSetAtom(takePendingTaskAtom)
    const sentPendingTaskFor = useRef<string | null>(null)
    const [pendingTaskError, setPendingTaskError] = useState<string | null>(null)
    const {isHydrating, send} = conversation
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

    // The auto-scroll effect keys on IDENTITY, so a fresh array every render would re-pin the
    // transcript on renders that changed nothing about it (a watch reconnect, a steer phase).
    // Memoized, it re-pins exactly when the turns actually change.
    const visibleTurns = useMemo(
        () => conversation.turns.filter((turn) => !turn.hidden),
        [conversation.turns],
    )
    const autoScroll = useTranscriptAutoScroll(visibleTurns)

    const streamingHere = conversation.status === "submitted" || conversation.status === "streaming"

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

    const scaffold = (
        <ScreenScaffold
            scrollRef={autoScroll.ref}
            onScroll={autoScroll.onScroll}
            scrollOverlay={
                <ChatJumpToLatest show={autoScroll.showJump} onClick={autoScroll.jumpToLatest} />
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
                    {/* A run this device is not driving. Docked with the other strips above the
                        composer, as on the desktop — it used to be a top bar that also appeared for
                        THIS device's own turns, duplicating the composer's Stop and shifting the
                        transcript twice per run. */}
                    {running && !streamingHere ? (
                        <ContentRail>
                            <RunningElsewhereStrip
                                action={<StopButton sessionId={sessionId} projectId={projectId} />}
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
                            <p className="text-destructive m-0 mb-2 text-xs">{pendingTaskError}</p>
                        </ContentRail>
                    ) : null}
                    <Composer
                        sessionId={sessionId}
                        onSend={({text, parts}) => conversation.send({text, parts})}
                        disabled={conversation.isHydrating || modelBlocked}
                        waitingOnUser={conversation.hitlPending}
                        streaming={streamingHere}
                        onStop={conversation.stop}
                        inputRef={composerRef}
                    />
                </div>
            }
        >
            {body}
        </ScreenScaffold>
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
