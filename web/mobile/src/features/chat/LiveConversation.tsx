import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    latestTurnId,
    resolveStopExecution,
    shouldShowStopControl,
    restoreRefusedSend as restoreRefusedSendInto,
} from "@agenta/chat/assets"
import {getPendingSecretInteractions} from "@agenta/chat/clientTools"
import {
    ConnectionDock,
    ConnectionFocusProvider,
    ConnectionWarningStrip,
    ElicitationDock,
    ModelSetupBanner,
    QueuedMessagesDock,
} from "@agenta/chat/components"
import type {QueuedMessage} from "@agenta/chat/hooks"
import {
    useAgentConversation,
    useAgentModelKeyStatus,
    useAgentModelSetup,
    useConnectionDock,
    useElicitationDock,
    useComposerAttachments,
} from "@agenta/chat/hooks"
import {
    getInteractionAvailability,
    getLivePendingApprovals,
    isSessionTurnStopping,
    refusedSendReason,
    SendRefusedError,
    type TurnViewModel,
} from "@agenta/chat/model"
import {getSessionTurnId} from "@agenta/chat/state"
import {
    cancelSessionExecution,
    dropUnacceptedLocalSessionAtom,
    isSessionFresh,
    markLocalSessionAcceptedAtom,
    registerLocalSessionAtom,
} from "@agenta/entities/session"
import {
    invalidateAgentCommittedRevisionCache,
    MODEL_SETUP_PLACEHOLDER,
    workflowBuildKitOverlayReadyAtomFamily,
} from "@agenta/entities/workflow"
import {AgentIntroCard} from "@agenta/entity-ui/agent"
import {SecretRequestDock} from "@agenta/entity-ui/clientTools"
import {AgentSetupCard, PersonalAccountsCard} from "@agenta/entity-ui/onboarding"
import {isOnScreen, isOverlayOpen} from "@agenta/shared/utils"
import {message, modal} from "@agenta/ui/app-message"
import {ChatBubble} from "@agenta/ui/components/presentational"
import {QuoteSelectionLayer} from "@agenta/ui/quote-selection"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {isAltChord} from "@agenta/ui/shortcuts"
import {Button} from "@agenta/ui/ui"
import {useQueryClient} from "@tanstack/react-query"
import type {FileUIPart} from "ai"
import {useAtomValue, useSetAtom, useStore} from "jotai"

import {ContentRail} from "@/components/ContentRail"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useProjectPermission} from "../context/useProjectPermission"
import {
    failPendingTaskAtom,
    keepFailedSendAtom,
    pendingTasksAtom,
    sendPendingTaskAtom,
} from "../home/pendingTask"
import {AppShell} from "../nav/AppShell"
import {livenessQueryKey, useLivenessUpdatedAt} from "../sessions/useLivenessPoll"
import {useWalletSummary} from "../wallet/useWalletSummary"

import {ApprovalDock} from "./ApprovalDock"
import {waitForBuildKit} from "./buildKitWait"
import {createCommitFollower} from "./commitFollower"
import {committedRevisionIds} from "./committedRevisionIds"
import {Composer} from "./Composer"
import {ConnectModelStrip} from "./ConnectModelStrip"
import {hasUnsavedConfigEdits} from "./hasUnsavedConfigEdits"
import {MODEL_KEY_WAIT_LIMIT_MS, pendingTaskDecision} from "./pendingTaskPolicy"
import {ReadOnlyComposerNotice} from "./ReadOnlyComposerNotice"
import {heldCommitAtomFamily, selectedRevisionAtomFamily} from "./selectedRevision"
import type {SessionReadOnly} from "./sessionReadOnly"
import {refreshOnSetupFailure} from "./setupFailureRefresh"
import {ChatLoading} from "./states/ChatStates"
import {PendingTaskError} from "./states/PendingTaskError"
import {cancelledStopAction} from "./stopHereState"
import {TranscriptTurns} from "./TranscriptTurns"
import {mobileTurnRowClass} from "./turnRowClass"
import {mergeAssistantRuns} from "./turnRuns"
import {deriveMobileRemoteTurnPresentation, showTrailingWorkingPulse} from "./turnStatus"
import {useApprovalActions, type ApprovalActions} from "./useApprovalActions"
import {useOpenModelSetup} from "./useOpenModelSetup"
import {usePersonalSetupStep} from "./usePersonalSetupStep"
import {useSessionSetupStep} from "./useSessionSetupStep"
import {useSessionWatch} from "./useSessionWatch"
import {useStartBlankSession} from "./useStartBlankSession"
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
/** The caret is in a field that is not ours — leave it there. */
const isTypingElsewhere = (active: Element | null): boolean =>
    active instanceof HTMLElement &&
    active !== document.body &&
    (active.isContentEditable || active.tagName === "INPUT" || active.tagName === "TEXTAREA")

export const LiveConversation = ({
    entityId,
    sessionId,
    projectId,
    workspaceId,
    running,
    stopStateLoading,
    sessionTurnId,
    stoppingTurnId,
    sharedReader,
    agentId,
    readOnly = null,
    canSend = true,
    embedded = false,
}: {
    entityId: string
    sessionId: string
    projectId: string
    workspaceId: string
    /** Backend liveness (cross-device) — shows the running strip even when this device idles. */
    running: boolean
    /** Initial liveness load and durable Stop ownership for remount recovery. */
    stopStateLoading: boolean
    sessionTurnId?: string | null
    stoppingTurnId?: string | null
    /** Backend-advertised ability to receive display-only live frames from another sender. */
    sharedReader: boolean
    /** React Query timestamp used to reject the sender's stale post-settle liveness snapshot. */
    /** Scopes the session tab rail to this agent's sessions. */
    agentId?: string | null
    /** The reader cannot send (`!sharing.can_send`): a notice takes the composer's place. */
    readOnly?: SessionReadOnly | null
    /**
     * The reader may write here. False while read-only and while the sharing state is not known
     * yet: every control that sends, approves, answers or re-runs is off, shortcuts included.
     */
    canSend?: boolean
    /** Rendered inside a workspace pane — the shell and its rail belong to the parent. */
    embedded?: boolean
}) => {
    // Subscribed HERE, not in ChatScreen: this timestamp moves on every poll tick even when the
    // payload is identical, so reading it higher up re-rendered the config pane and its drawers.
    const livenessUpdatedAt = useLivenessUpdatedAt(projectId)
    const startBlankSession = useStartBlankSession(`/w/${workspaceId}/p/${projectId}`)
    // The composer's input handle. Declared here because the released task puts its text back in
    // the composer, rewind (far below) refills it the same way, and a refused send comes back
    // through it too.
    const composerRef = useRef<RichChatInputHandle | null>(null)
    // Quote-to-reply anchors its pill and note box inside the transcript rail.
    const quoteRootRef = useRef<HTMLDivElement>(null)
    // The composer's tray, owned here for the same reason: a refusal that arrives after the send
    // resolved has to put the files back from outside the composer's own submit.
    const attachments = useComposerAttachments({sessionId, largeFilesToDrive: true})
    const {restoreAttachments, setRejections} = attachments
    const restoreRefusedSend = useCallback(
        async (message: QueuedMessage) => {
            const taken = await restoreRefusedSendInto(
                composerRef.current,
                {
                    text: message.text,
                    stagedFiles: message.stagedFiles ?? [],
                    fileParts: message.fileParts ?? [],
                },
                restoreAttachments,
            )
            if (taken) setRejections([{name: "Message", reason: "wasn't sent — try again."}])
            return taken
        },
        [restoreAttachments, setRejections],
    )

    // The rail row for a fresh session follows its first send: admitted keeps it until the server
    // lists the session, rejected or refused drops it (nothing will ever list that session).
    const registerLocalSession = useSetAtom(registerLocalSessionAtom)
    const markLocalSessionAccepted = useSetAtom(markLocalSessionAcceptedAtom)
    const dropUnacceptedLocalSession = useSetAtom(dropUnacceptedLocalSessionAtom)
    // A send outlives this screen. One that fails after the user left has no composer to go back
    // to, so its session stays listed and the message waits as a failed task for their return.
    const keepFailedSend = useSetAtom(keepFailedSendAtom)
    const onScreenRef = useRef(false)
    useEffect(() => {
        onScreenRef.current = true
        return () => {
            onScreenRef.current = false
        }
    }, [])
    const sendFailed = useCallback(
        (message: {text: string; fileParts?: FileUIPart[]}, error?: unknown) => {
            refreshOnSetupFailure(error instanceof SendRefusedError ? error.refusalCode : null)
            if (onScreenRef.current) {
                dropUnacceptedLocalSession(sessionId)
                return
            }
            keepFailedSend({
                sessionId,
                task: {
                    agentId: agentId ?? entityId,
                    text: message.text,
                    parts: message.fileParts,
                    failureReason: refusedSendReason(error) ?? undefined,
                },
            })
        },
        [agentId, dropUnacceptedLocalSession, entityId, keepFailedSend, sessionId],
    )
    const followCommitRef = useRef<(revisionId: string) => void>(() => undefined)
    const conversation = useAgentConversation({
        entityId,
        sessionId,
        onCommittedRevision: ({revisionId}) => followCommitRef.current(revisionId),
        sharedReaderAdvertised: sharedReader,
        sharedReaderRunning: running,
        sharedReaderLivenessUpdatedAt: livenessUpdatedAt,
        restoreRefusedSend,
        onSendAccepted: () => markLocalSessionAccepted(sessionId),
        onSendFailed: sendFailed,
    })
    const canEditSecrets = useProjectPermission(projectId, "edit_secret")
    const store = useStore()
    const pinRevision = useSetAtom(selectedRevisionAtomFamily(sessionId))
    const {adoptRevision} = conversation
    const adoptSecretRevision = useCallback(
        (next: string) => {
            adoptRevision(next)
            pinRevision(next)
        },
        [adoptRevision, pinRevision],
    )
    const pendingSecret = useMemo(
        () => getPendingSecretInteractions(conversation.messages)[0],
        [conversation.messages],
    )

    // The agent committing itself in THIS session: follow it — pin the workspace and retarget the
    // next send — and drop the latest-revision caches, or the pane and the chip keep the revision
    // it replaced. A durable send learns it from the records reader; a `useChat` stream carries a
    // `data-committed-revision` part. The follower acts once per commit, and holds a commit that
    // lands while the tab is hidden until the tab is visible again. Commits made elsewhere (another
    // user, another session) never come through here: the version pill offers those.
    const applyCommitRef = useRef<(revisionId: string) => void>(() => undefined)
    applyCommitRef.current = (revisionId: string) => {
        invalidateAgentCommittedRevisionCache()
        if (revisionId === entityId) return
        // Unsaved edits in the config pane belong to the pinned revision. Switching now would drop
        // them, so the version pill offers the commit instead.
        if (hasUnsavedConfigEdits(store, entityId)) {
            store.set(heldCommitAtomFamily(sessionId), revisionId)
            return
        }
        adoptSecretRevision(revisionId)
    }
    const [commitFollower] = useState(() =>
        createCommitFollower({
            apply: (revisionId) => applyCommitRef.current(revisionId),
            isVisible: () => document.visibilityState === "visible",
        }),
    )
    followCommitRef.current = commitFollower.report
    useEffect(() => {
        const onVisibility = () => commitFollower.flush()
        document.addEventListener("visibilitychange", onVisibility)
        return () => document.removeEventListener("visibilitychange", onVisibility)
    }, [commitFollower])
    useEffect(() => {
        for (const revisionId of committedRevisionIds(conversation.messages))
            followCommitRef.current(revisionId)
    }, [conversation.messages])

    // The connect-model gate — desktop parity. The engine deliberately leaves this to the skin
    // (`useAgentConversation` says so): a keyless project must be told to add a key BEFORE the
    // send, not shown a raw 422 after it. Blocks the composer, holds the parked task, and raises
    // the strip below.
    const modelKey = useAgentModelKeyStatus(entityId)
    const wallet = useWalletSummary(projectId, {poll: false})
    const hasCredits = wallet.data?.mode === "enforce" && (wallet.data.spendable_musd ?? 0) > 0
    // Wallet credits fund runs without a key, and an unanswered wallet is not "no credits".
    const walletPending = modelKey.gateActive && wallet.isLoading
    const modelBlocked = modelKey.gateActive && !hasCredits && !wallet.isLoading
    // The server's needs-setup check: a model item that needs setup turns Send off, not typing.
    // Subscribed here so the check starts with the screen's other requests.
    const modelSetup = useAgentModelSetup(entityId)
    const setupBlocked = modelSetup.blocked && !modelBlocked
    const openModelSetup = useOpenModelSetup()
    // The strips stay hidden until the vault, the wallet and the needs-setup check answer, but the
    // parked task must NOT go out on that same unknown — see `pendingTaskPolicy`.
    const modelKeyLoading = modelKey.loading || walletPending || modelSetup.loading

    // The wait for the vault, the wallet and the needs-setup check is bounded (`pendingTaskPolicy`).
    // This stays 0 while the wait is on and becomes the elapsed time when the deadline fires, which
    // is the render that releases the task.
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

    // Landing on a session — a new one from `+` or the shortcut, or a switch to an existing one —
    // puts the caret in the composer, once it can take input. Not while the caret is already in
    // some other field: a self-commit remounts this screen mid-edit in the config pane.
    // One gate for every write on this screen.
    const locked = !canSend || Boolean(readOnly)
    // Access can go while a confirm dialog is open: late callbacks read the gate as it is now.
    const lockedRef = useRef(locked)
    lockedRef.current = locked
    // A screen that is gone (the chat was taken away) answers every late callback as locked.
    useEffect(() => {
        lockedRef.current = locked
        return () => {
            lockedRef.current = true
        }
    }, [locked])
    const disabled = conversation.isHydrating || modelBlocked || walletPending || locked
    useEffect(() => {
        if (disabled) return
        const frame = requestAnimationFrame(() => {
            if (isTypingElsewhere(document.activeElement)) return
            composerRef.current?.focus()
        })
        return () => cancelAnimationFrame(frame)
    }, [disabled, sessionId])

    // Keep Home tasks session-scoped until admission; failures require an explicit retry.
    const pendingTasks = useAtomValue(pendingTasksAtom)
    const pendingTask = pendingTasks[sessionId]
    const heldTaskText = pendingTask?.delivery === "sending" ? null : pendingTask?.text
    const sendPendingTask = useSetAtom(sendPendingTaskAtom)
    const failPendingTask = useSetAtom(failPendingTaskAtom)
    const pendingTaskError = pendingTask?.delivery === "failed"
    const {
        isHydrating,
        revalidate,
        send: sendToConversation,
        stop,
        voidPendingResume,
    } = conversation
    // Subscribed here so the build-kit overlay loads while the user types the first message.
    const buildKitReadyAtom = workflowBuildKitOverlayReadyAtomFamily(entityId)
    useAtomValue(buildKitReadyAtom)
    const firstTurn = conversation.messages.length === 0
    // A fresh session becomes real on the server only once this first message is admitted, which
    // can take seconds on a cold runner. Note it locally first, so the rail lists it now (#6776).
    // Every first send (composer, Home task, retry) comes through here, so it is also where the
    // first turn waits for the build kit.
    const send = useCallback(
        async (input: Parameters<typeof sendToConversation>[0]) => {
            if (isSessionFresh(sessionId)) {
                registerLocalSession({
                    sessionId,
                    projectId,
                    agentId: agentId ?? null,
                    name: input.text,
                })
            }
            if (firstTurn && !(await waitForBuildKit(store, buildKitReadyAtom))) {
                console.warn(
                    "[mobile chat] build-kit overlay not ready after 10s; sending without it",
                )
            }
            try {
                await sendToConversation(input)
            } catch (error) {
                // The durable path reports this through `onSendFailed` too; this covers the rest.
                sendFailed({text: input.text, fileParts: input.parts}, error)
                throw error
            }
        },
        [
            agentId,
            buildKitReadyAtom,
            firstTurn,
            projectId,
            registerLocalSession,
            sendFailed,
            sendToConversation,
            sessionId,
            store,
        ],
    )
    // A template create asks for its accounts here, on arrival, instead of on a create surface of
    // its own. Holds the first message while it does; declines silently when there is nothing to
    // ask, which is every other way into this screen.
    const setup = useSessionSetupStep(sessionId)
    // The viewer's own missing "user" items. Optional: it never holds a message.
    const personalSetup = usePersonalSetupStep(sessionId, entityId)
    useEffect(() => {
        if (!pendingTask || pendingTask.delivery || locked) return
        const decision = pendingTaskDecision({
            sessionId,
            sentFor: null,
            hydrating: isHydrating,
            modelKeyLoading,
            modelKeyWaitedMs,
            modelBlocked: modelBlocked || setupBlocked,
            setupBlocking: setup.blocking,
        })
        if (decision === "hold") return
        if (decision === "abandon") {
            failPendingTask(sessionId)
            return
        }
        void sendPendingTask({
            sessionId,
            send: (task) => send({text: task.text, parts: task.parts}),
        })
    }, [
        pendingTask,
        isHydrating,
        modelKeyLoading,
        modelKeyWaitedMs,
        modelBlocked,
        setupBlocked,
        setup.blocking,
        send,
        sessionId,
        sendPendingTask,
        failPendingTask,
        locked,
    ])

    const queryClient = useQueryClient()
    useEffect(() => {
        if (conversation.sharedSettledAt) {
            void queryClient.invalidateQueries({queryKey: livenessQueryKey(projectId)})
        }
    }, [conversation.sharedSettledAt, projectId, queryClient])
    const streamingHere = conversation.status === "submitted" || conversation.status === "streaming"
    const remoteTurn = deriveMobileRemoteTurnPresentation({
        livenessRunning: running,
        livenessUpdatedAt,
        sharedSettledAt: conversation.sharedSettledAt,
        snapshotRunning: conversation.runningFromSnapshot,
        sharedReaderAdvertised: sharedReader,
        readerReady: conversation.readerReady,
        ownedContinuation: conversation.acceptedRunPending,
    })
    // `sendInFlight` covers the gap the other two cannot: the message has left the composer, and
    // neither `useChat` (the server-owned path never moves its status) nor liveness (a poll away)
    // knows yet. Without it the pulse arrived a runner accept plus a poll after the send (#6778).
    // `inputBusy`: the server's execution state, the same signal as the composer's ring.
    const showingTurnActivity =
        streamingHere ||
        conversation.sendInFlight ||
        conversation.inputBusy ||
        remoteTurn.showActivity
    const streamingHereRef = useRef(streamingHere)
    streamingHereRef.current = streamingHere
    const hitlPendingRef = useRef(conversation.hitlPending)
    hitlPendingRef.current = conversation.hitlPending
    const [stoppingHere, setStoppingHere] = useState(false)
    const stopWatchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const awaitingServerStopRef = useRef(false)
    const expectedStopExecutionIdRef = useRef<string | undefined>(undefined)
    const retryStopRef = useRef(false)
    const stopSessionIdRef = useRef(sessionId)
    stopSessionIdRef.current = sessionId
    const serverStopping = isSessionTurnStopping({
        currentTurnId: sessionTurnId ?? latestTurnId(conversation.messages),
        stoppingTurnId,
    })
    const stopping =
        stoppingHere || serverStopping || (stopStateLoading && conversation.hitlPending)
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
    const {interactionChanged} = conversation
    const watch = useSessionWatch({
        sessionId,
        projectId,
        onRecordsChanged: revalidate,
        onInteractionChanged: interactionChanged,
        sharedReaderAdvertised: sharedReader,
    })
    // Poll slowly while a cross-device run cannot be watched live.
    useEffect(() => {
        if (watch.connected || !running) return
        const timer = setInterval(() => revalidate(), 7_500)
        return () => clearInterval(timer)
    }, [watch.connected, running, revalidate])
    useEffect(() => {
        if (streamingHere || !stopWatchdogTimerRef.current) return
        // A stop of a run not streamed here holds until the server marks it or the run ends.
        if (awaitingServerStopRef.current && !serverStopping && showingTurnActivity) return
        awaitingServerStopRef.current = false
        clearTimeout(stopWatchdogTimerRef.current)
        stopWatchdogTimerRef.current = null
        retryStopRef.current = false
        expectedStopExecutionIdRef.current = undefined
        setStoppingHere(false)
    }, [streamingHere, serverStopping, showingTurnActivity])
    useEffect(
        () => () => {
            if (stopWatchdogTimerRef.current) clearTimeout(stopWatchdogTimerRef.current)
        },
        [],
    )
    const stopResolutionRef = useRef<AbortController | null>(null)
    useEffect(
        () => () => {
            stopResolutionRef.current?.abort()
        },
        [sessionId],
    )

    // Composer Stop cancels on the server before changing local presentation.
    const stopHere = useCallback(() => {
        if (stopping) return
        // Fence a delayed approval release even when cancellation cannot be requested yet.
        voidPendingResume()
        if (!projectId || !sessionId) return
        setStoppingHere(true)
        const wasParked = !streamingHereRef.current && conversation.hitlPending
        const isRetry = retryStopRef.current
        const expectedExecutionId = isRetry
            ? expectedStopExecutionIdRef.current
            : getSessionTurnId(sessionId)
        retryStopRef.current = false
        let resolutionController: AbortController | null = null
        const cancel = async () => {
            let resolvedExecutionId = expectedExecutionId
            if (!isRetry && !resolvedExecutionId && streamingHereRef.current) {
                const controller = new AbortController()
                resolutionController = controller
                stopResolutionRef.current?.abort()
                stopResolutionRef.current = controller
                const resolution = await resolveStopExecution({
                    readExecutionId: () => getSessionTurnId(sessionId),
                    isRunActive: () => streamingHereRef.current,
                    signal: controller.signal,
                })
                if (stopResolutionRef.current === controller) stopResolutionRef.current = null
                if (resolution.status !== "resolved") return {resolution} as const
                resolvedExecutionId = resolution.executionId
            }
            expectedStopExecutionIdRef.current = resolvedExecutionId
            const outcome = await cancelSessionExecution({
                sessionId,
                projectId,
                expectedExecutionId: resolvedExecutionId,
            })
            return {outcome} as const
        }
        void cancel()
            .then((result) => {
                if ("resolution" in result && result.resolution) {
                    if (result.resolution.status === "settled") {
                        setStoppingHere(false)
                    } else if (result.resolution.status === "timed_out") {
                        setStoppingHere(false)
                        message.warning("Could not identify the run to stop. Please try again.")
                    }
                    return
                }
                const {outcome} = result
                if (stopSessionIdRef.current !== sessionId) return
                if (outcome?.accepted) {
                    const action = cancelledStopAction({
                        parkedAtRequest: wasParked,
                        parkedAtResponse: !streamingHereRef.current && hitlPendingRef.current,
                        streaming: streamingHereRef.current,
                        retry: isRetry,
                        executionState: outcome.execution.state,
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
                    if (action === "abort-settled" || action === "abort-retry") {
                        stop()
                        setStoppingHere(false)
                        expectedStopExecutionIdRef.current = undefined
                        return
                    }
                    awaitingServerStopRef.current = action === "await-server"
                    stopWatchdogTimerRef.current = setTimeout(() => {
                        retryStopRef.current = true
                        stopWatchdogTimerRef.current = null
                        awaitingServerStopRef.current = false
                        setStoppingHere(false)
                    }, 30_000)
                    return
                }
                setStoppingHere(false)
                if (outcome && !outcome.conflict && outcome.execution.state === "idle") {
                    retryStopRef.current = false
                    expectedStopExecutionIdRef.current = undefined
                    return
                }
                if (outcome?.conflict) {
                    retryStopRef.current = false
                    expectedStopExecutionIdRef.current = undefined
                } else if (isRetry) {
                    retryStopRef.current = true
                }
                message.warning(
                    outcome?.conflict
                        ? "That run had already finished. The session is running something else now."
                        : "Could not stop the run. It may still be running.",
                )
            })
            .catch((error: unknown) => {
                if (stopResolutionRef.current === resolutionController) {
                    stopResolutionRef.current = null
                }
                if (stopSessionIdRef.current !== sessionId) return
                if (isRetry) retryStopRef.current = true
                setStoppingHere(false)
                message.warning(
                    error instanceof Error
                        ? error.message
                        : "Could not stop the run. It may still be running.",
                )
            })
    }, [
        projectId,
        sessionId,
        stop,
        stopping,
        conversation.hitlPending,
        settleParkedStop,
        voidPendingResume,
    ])

    const interactionAvailability = getInteractionAvailability({
        stopped: conversation.stopped,
        stopping,
        streaming: streamingHere,
    })
    const pendingApprovals = useMemo(
        () =>
            getLivePendingApprovals(conversation.messages, {
                stopped: !interactionAvailability.approvals,
            }),
        [conversation.messages, interactionAvailability.approvals],
    )
    // The dock drops a gate as we answer it; `pendingApprovals` lags until the transcript catches up.
    const approvalsOpen = pendingApprovals.length > 0 && conversation.approvals.open
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
            phase: conversation.approvals.recoverable
                ? "recoverable"
                : conversation.approvals.answered
                  ? "answered"
                  : conversation.approvals.responding
                    ? "resuming"
                    : conversation.approvals.errorText
                      ? "error"
                      : steerActions.phase,
            errorText: conversation.approvals.errorText ?? steerActions.errorText,
            respond: ({approved, message, approvalId}) => {
                if (locked) return
                if (message) {
                    steerActions.respond({approvalId, approved, message})
                    return
                }
                conversation.approvals.respond(approved)
            },
            approveAll: () => {
                if (!locked) conversation.approvals.approveAll()
            },
        }),
        [conversation.approvals, locked, steerActions],
    )

    // The auto-scroll effect keys on IDENTITY, so a fresh array every render would re-pin the
    // transcript on renders that changed nothing about it (a watch reconnect, a steer phase).
    // Memoized, it re-pins exactly when the turns actually change.
    const visibleTurns = useMemo(
        () => mergeAssistantRuns(conversation.turns.filter((turn) => !turn.hidden)),
        [conversation.turns],
    )
    const autoScroll = useTranscriptAutoScroll(visibleTurns)

    // Parked connect interactions → the dock above the composer owns their actions, so a paused
    // run can't scroll out of reach. Gated the same way desktop gates it.
    // Parked question forms → the docked card owns the questions and the answers; the transcript
    // rows are passive markers.
    const elicits = useElicitationDock({
        messages: conversation.messages,
        enabled: interactionAvailability.parkedDocks && !locked,
        approvalsPending: approvalsOpen,
        onOutput: conversation.sendToolOutput,
    })
    const connects = useConnectionDock({
        messages: conversation.messages,
        enabled: interactionAvailability.parkedDocks && !locked,
        approvalsPending: approvalsOpen,
        elicitationPending: elicits.open,
        onOutput: conversation.sendToolOutput,
    })
    // The docks know an ask is answered before `hitlPending` does; an ask with no dock stays a wait.
    const cardOpen = approvalsOpen || elicits.open || connects.open || Boolean(pendingSecret)
    const answerInFlight =
        conversation.approvals.settledIds.size > 0 ||
        elicits.settlingIds.size > 0 ||
        connects.settlingIds.size > 0
    const parkedOnUser = conversation.hitlPending && (cardOpen || !answerInFlight)
    const resumingAfterAnswer = conversation.hitlPending && !cardOpen && answerInFlight

    const secretDockOpen =
        !locked && !streamingHere && !stopping && !conversation.stopped && Boolean(pendingSecret)
    // Rewind: re-run the conversation from a turn. The hook only SCANS (it never opens dialogs),
    // so the warning about tools that already ran, and putting a rewound user message back into
    // the composer, are this surface's job — same division the desktop uses. `composerRef` is
    // declared above, with the parked task that also refills the input.
    const {rewind} = conversation
    const handleRewind = useCallback(
        (turn: TurnViewModel) => {
            const plan = rewind(turn.message)
            if (!plan) return
            const run = () => {
                // Access can go while the confirmation is open: the OK then writes nothing.
                if (lockedRef.current) return
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
        [rewind],
    )

    // The desktop's run-level shortcuts, with its guards — what makes Stop's `Escape` true here.
    const scrollerRef = autoScroll.ref
    // Read through a ref: `pendingApprovals` is rebuilt every streamed commit, so depending on it
    // would re-register the listener on the hot path.
    const shortcutRef = useRef({streamingHere, pendingApprovals, approvalActions, stopHere, locked})
    shortcutRef.current = {streamingHere, pendingApprovals, approvalActions, stopHere, locked}
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            // Radix lets a cancelled Escape through and never touches Alt+G; the pane can hide us.
            if (e.defaultPrevented || isOverlayOpen()) return
            if (!isOnScreen(scrollerRef.current)) return
            const current = shortcutRef.current
            if (e.key === "Escape" && !e.isComposing && current.streamingHere) {
                e.preventDefault()
                // `stopHere`, not the local abort: Escape must cancel the run on the server too.
                current.stopHere()
                return
            }
            // ONE gate, never "Approve all" — a mis-press must not grant a tool nobody read.
            // Someone who cannot send cannot approve either, by key no more than by tap.
            if (
                isAltChord(e) &&
                e.code === "KeyG" &&
                !current.locked &&
                current.pendingApprovals.length > 0
            ) {
                e.preventDefault()
                current.approvalActions.respond({
                    approved: true,
                    approvalId: current.pendingApprovals[0].approvalId,
                })
            }
        }
        document.addEventListener("keydown", onKey)
        return () => document.removeEventListener("keydown", onKey)
    }, [scrollerRef])

    let body
    if (conversation.isHydrating) {
        body = <ChatLoading />
    } else {
        body = (
            <ContentRail
                ref={quoteRootRef}
                className="relative flex grow flex-col gap-3 p-4 pt-6 pb-[calc(1rem+env(safe-area-inset-bottom))]"
            >
                <QuoteSelectionLayer rootRef={quoteRootRef} sessionId={sessionId} touch />
                {/* A held or failed Home task stays visible until accepted. */}
                {heldTaskText ? (
                    <div className={`${mobileTurnRowClass} justify-end`}>
                        <ChatBubble
                            placement="end"
                            variant="filled"
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
                        {conversation.historyReadFailed ? (
                            <div className="mt-3 flex flex-col items-center gap-2">
                                <p className="text-muted-foreground m-0 text-center text-xs">
                                    Couldn&apos;t load this session&apos;s earlier messages.
                                </p>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={conversation.retryHistory}
                                >
                                    Try again
                                </Button>
                            </div>
                        ) : conversation.historyUnavailable ? (
                            <p className="text-muted-foreground mt-3 text-center text-xs">
                                This session&apos;s earlier messages are no longer stored. New
                                messages still work.
                            </p>
                        ) : null}
                    </div>
                ) : null}
                <TranscriptTurns
                    turns={visibleTurns}
                    sessionId={sessionId}
                    remoteRunning={showingTurnActivity && !streamingHere}
                    waitingOnUser={parkedOnUser}
                    resuming={resumingAfterAnswer}
                    pending={showTrailingWorkingPulse(showingTurnActivity, visibleTurns)}
                    // A tool answer and a rewind both write: someone who cannot send here cannot
                    // answer a tool or re-run a turn (retry rides rewind) either.
                    onClientToolOutput={locked ? undefined : conversation.sendToolOutput}
                    onRewind={locked ? undefined : handleRewind}
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
                embedded={embedded}
                // Edge fades as a MASK, only where content is clipped — the Home list's rule, so
                // the first message reads crisp at the top and the bottom says there is more.
                scrollStyle={{
                    maskImage: autoScroll.edgeMask,
                    WebkitMaskImage: autoScroll.edgeMask,
                }}
                footer={
                    <div className="relative">
                        {/* What you have lined up stays visible while a gate is open: the queued
                        message is the acknowledgement that the user's Send was not lost. */}
                        {/* Not for a reader who cannot send: every row control (send now, edit,
                        remove) writes, and nothing they queued can go out from here. */}
                        {!locked && (conversation.queued.length > 0 || conversation.editingId) ? (
                            <div className="bg-background shrink-0 px-3 pt-3 pb-0">
                                <ContentRail>
                                    <QueuedMessagesDock
                                        queued={conversation.queued}
                                        held={conversation.hitlPending}
                                        onRemove={conversation.removeQueued}
                                        onSendNow={conversation.sendQueuedNow}
                                        sendNowBlocked={conversation.sendNowPending}
                                        onEdit={editQueued}
                                        onCancelEdit={cancelQueuedEdit}
                                        editingId={conversation.editingId}
                                        touch
                                    />
                                </ContentRail>
                            </div>
                        ) : null}
                        {conversation.connectionWarning ? (
                            <ContentRail>
                                <ConnectionWarningStrip message={conversation.connectionWarning} />
                            </ContentRail>
                        ) : null}
                        {approvalsOpen ? (
                            <ApprovalDock
                                approvals={pendingApprovals}
                                actions={approvalActions}
                                entityId={entityId}
                                bottomMost={false}
                                readOnly={locked}
                                readOnlyNote={readOnly?.approvalNote}
                            />
                        ) : null}
                        {/* Parked question forms, between approval and connect — the same order as
                        desktop, and the same order as the keyboard precedence. */}
                        {secretDockOpen && pendingSecret ? (
                            <ContentRail>
                                <SecretRequestDock
                                    key={pendingSecret.toolCallId}
                                    meta={pendingSecret}
                                    revisionId={entityId}
                                    onAdoptRevision={adoptSecretRevision}
                                    canEditSecrets={canEditSecrets}
                                    onOutput={conversation.sendToolOutput}
                                />
                            </ContentRail>
                        ) : null}
                        {elicits.open ? (
                            <div className="bg-background shrink-0 px-3 pt-3 pb-0">
                                <ContentRail>
                                    <ElicitationDock
                                        elicits={elicits}
                                        onOutput={elicits.settle}
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
                                        onOutput={connects.settle}
                                        touch
                                    />
                                </ContentRail>
                            </div>
                        ) : null}
                        {/* The template's accounts, asked for once on arrival. Above the model
                        strip because it is what the user came here holding: the first message is
                        parked behind it, and "Continue" is what releases it. */}
                        {setup.open && !locked ? (
                            <div className="bg-background shrink-0 px-3 pt-3 pb-0">
                                <ContentRail>
                                    <AgentSetupCard
                                        accounts={setup.accounts}
                                        suggestions={setup.suggestions}
                                        onAddAccount={setup.addAccount}
                                        onCreate={setup.resolve}
                                        onDismiss={setup.resolve}
                                        createLabel="Continue"
                                    />
                                </ContentRail>
                            </div>
                        ) : null}
                        {/* The viewer's own accounts for this agent's "user" items. After the
                        template step, which asks first when both would show. */}
                        {personalSetup.open && !setup.open && !locked ? (
                            <div className="bg-background shrink-0 px-3 pt-3 pb-0">
                                <ContentRail>
                                    <PersonalAccountsCard
                                        workflowId={personalSetup.workflowId}
                                        items={personalSetup.items}
                                        pendingKeys={personalSetup.pendingKeys}
                                        onContinue={personalSetup.close}
                                        onDismiss={personalSetup.close}
                                    />
                                </ContentRail>
                            </div>
                        ) : null}
                        {/* Docked with the other strips, directly above the composer it disables —
                        the same place the desktop banner sits. */}
                        <ContentRail>
                            <ConnectModelStrip gateActive={modelBlocked} />
                            {modelBlocked ? null : (
                                <ModelSetupBanner revisionId={entityId} onSetUp={openModelSetup} />
                            )}
                        </ContentRail>
                        {/* Failed Home tasks retain their original text and files for retry. */}
                        {pendingTaskError ? (
                            <PendingTaskError
                                failureReason={pendingTask?.failureReason}
                                filenames={pendingTask?.parts?.map(
                                    (part) => part.filename || "Attachment",
                                )}
                                // A template task left while its connect step held it comes
                                // back failed; the step still goes first.
                                retryDisabled={
                                    locked ||
                                    setup.blocking ||
                                    isHydrating ||
                                    modelBlocked ||
                                    setupBlocked ||
                                    (modelKeyLoading && modelKeyWaitedMs < MODEL_KEY_WAIT_LIMIT_MS)
                                }
                                onRetry={() => {
                                    if (locked || setup.blocking) return
                                    void sendPendingTask({
                                        sessionId,
                                        retry: true,
                                        send: (task) => send({text: task.text, parts: task.parts}),
                                    })
                                }}
                            />
                        ) : null}
                        {readOnly ? (
                            <ReadOnlyComposerNotice text={readOnly.notice} />
                        ) : (
                            <Composer
                                entityId={entityId}
                                sessionId={sessionId}
                                attachments={attachments}
                                onRefusedOverDraft={({text, parts}) =>
                                    conversation.keepRefusedSend({text, fileParts: parts})
                                }
                                onSend={async ({text, parts, stagedFiles}) => {
                                    if (locked) return
                                    setStoppingHere(false)
                                    // An open edit rewrites its held message instead of sending. The
                                    // input clears on submit, so the displaced draft goes back after.
                                    if (!conversation.editingId) {
                                        // A message typed over a parked question or connection
                                        // request replaces it: the cards settle exactly as their own
                                        // ✕ / "Not now" would, then the message steers into the
                                        // resumed run so the agent reads it next, not after. A
                                        // dismiss that fails throws here, and the composer's catch
                                        // puts the text back with the cards intact. `steer` rather
                                        // than `send`: the session has already run, so there is no
                                        // fresh-session registration to do.
                                        //
                                        // Settled together, not in sequence: a failure after one dock
                                        // had already gone would hand the text back with that dock's
                                        // request silently cancelled. Both writes go out, and the
                                        // first rejection is what the composer reports.
                                        if (elicits.open || connects.open) {
                                            await Promise.all([
                                                elicits.open ? elicits.dismiss() : null,
                                                connects.open ? connects.dismiss() : null,
                                            ])
                                            await conversation.steer({text, parts, stagedFiles})
                                            return
                                        }
                                        await send({text, parts, stagedFiles})
                                        return
                                    }
                                    const draft = await conversation.commitEdit({
                                        text,
                                        fileParts: parts,
                                    })
                                    if (draft)
                                        requestAnimationFrame(() =>
                                            composerRef.current?.setMarkdown(draft),
                                        )
                                }}
                                onSteer={async ({text, parts, stagedFiles}) => {
                                    if (!locked)
                                        await conversation.steer({text, parts, stagedFiles})
                                }}
                                disabled={disabled}
                                sendDisabled={setupBlocked}
                                placeholder={
                                    modelBlocked
                                        ? "Connect a model to start chatting…"
                                        : setupBlocked
                                          ? MODEL_SETUP_PLACEHOLDER
                                          : undefined
                                }
                                hasTurns={!conversation.isEmpty}
                                waitingOnUser={parkedOnUser}
                                streaming={shouldShowStopControl({
                                    busy: streamingHere,
                                    hitlPending: conversation.hitlPending,
                                })}
                                stopping={stopping}
                                onStop={stopHere}
                                inputBusy={conversation.inputBusy}
                                inputRef={composerRef}
                                // Same gate the rail's `+` uses: starting one needs an agent.
                                onNewSession={
                                    agentId ? () => startBlankSession(agentId) : undefined
                                }
                            />
                        )}
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
