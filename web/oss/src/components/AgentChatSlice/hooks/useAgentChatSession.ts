import {useCallback, useEffect, useMemo, useReducer, useRef, useState} from "react"

import {
    buildRequestWithinDeadline,
    getMessageTraceId,
    latestTurnId,
    prepareAfterContinuationPreflight,
    resolveStopExecution,
    startupLabelFromDataPart,
    submitApprovalForCapability,
} from "@agenta/chat/assets"
import type {ClientToolOutputHandler} from "@agenta/chat/clientTools"
import {useSessionChat} from "@agenta/chat/hooks"
import {
    classifyAgentRunError,
    ignoreStreamRejection,
    createUserStoppedState,
    isSessionTurnStopping,
    reduceUserStoppedState,
    type RunErrorMetadata,
    withoutSharedSenderAcceptanceMessages,
} from "@agenta/chat/model"
import {
    acceptedRunBySession,
    clearTurnClockAtom,
    stampMessagesCreatedAtAtom,
    startTurnClockAtom,
    turnDeliverySourceBySession,
    type TurnDeliverySource,
} from "@agenta/chat/state"
import {expandedKeysForMessages, pruneExpandedAtom} from "@agenta/chat/state"
import {
    clearSessionTurnId,
    getSessionTurnId,
    isChatBusy,
    persistSessionMessagesAtom,
    sessionMessagesAtom,
    sessionRecordCountsReadAtom,
    setSessionStatusAtom,
    setSessionTurnId,
    setAcceptedSessionTurnId,
    type SessionChatHooks,
} from "@agenta/chat/state"
import {
    cancelSessionExecution,
    invalidateSessionListQueries,
    killSession,
    recordInteractionAnswerAtom,
    respondInteractionAnswerAtom,
    respondInteractionAnswersAtom,
    resumeSessionContinuationAtom,
    sessionDurableApprovalsCapabilityAtom,
    revalidateSessionMountsAtom,
    revalidateSessionRecordsAtom,
} from "@agenta/entities/session"
import {markTraceAsFresh} from "@agenta/entities/trace"
import {invalidateAgentCommittedRevisionCache, workflowMolecule} from "@agenta/entities/workflow"
import {
    agentShouldResumeAfterApproval,
    approvalResolution,
    buildAgentRequest,
    buildTurnCapture,
    isHitlPending,
    isResumeSend,
    playgroundController,
    recordAnswerThenRelease,
    type LiveAgentInteraction,
} from "@agenta/playground"
import {agentSelfCommitSignalAtom} from "@agenta/shared/state"
import {generateId} from "@agenta/shared/utils"
import {message} from "@agenta/ui/app-message"
import {useChat} from "@ai-sdk/react"
import {useQueryClient} from "@tanstack/react-query"
import {type UIMessage} from "ai"
import {useAtomValue, useSetAtom, useStore} from "jotai"

import {projectIdAtom} from "@/oss/state/project"

import {doesAgentChatStopKillSession} from "../assets/constants"
import {isStoppingPhase, reduceStopPhase} from "../assets/stopState"
import {invalidateSessionInspector} from "../components/Inspector/invalidate"
import {useChatScopeKey} from "../state/scope"
import {openSessionIdsAtomFamily} from "../state/sessions"
import {captureTurnRequestAtom} from "../state/turnCaptures"

import {useFileActivityDetector} from "./useFileActivityDetector"
import {type ScrollIntent} from "./useScrollIntent"
import {useSessionHydration} from "./useSessionHydration"
import {useToolCacheInvalidation} from "./useToolCacheInvalidation"

/**
 * The chat stream for one session tab: transport, `useChat`, and every side effect that belongs to
 * the conversation itself — history hydration, persistence, error stamping, self-commit pickup,
 * stop/kill, and teardown. Everything the UI layers on top (queue, approvals, onboarding, the
 * composer) consumes this hook's return rather than reaching for `useChat` directly.
 *
 * Design decisions baked in (docs/design/agent-workflows/projects/session-chat-registry/decisions.md):
 *  - D9  teardown: release the chat on unmount; `@agenta/chat`'s session-chat registry owns
 *        the instance and decides whether to preserve it (#5724).
 *  - DT3 cancelled state: a stopped stream tags its partial bubble "Stopped" + offers Resend.
 */
export const useAgentChatSession = ({
    entityId,
    sessionId,
    initialMessages,
    intent,
}: {
    entityId: string
    sessionId: string
    /** Mount seed read from the persisted store by the caller (it also seeds the scroll intent). */
    initialMessages: UIMessage[]
    intent: ScrollIntent
}) => {
    const store = useStore()
    const persistMessages = useSetAtom(persistSessionMessagesAtom)
    const stampMessagesCreatedAt = useSetAtom(stampMessagesCreatedAtAtom)
    const switchEntity = useSetAtom(playgroundController.actions.switchEntity)

    // Ids already on screen — restored/settled turns don't re-animate; only turns added live fade in.
    const seenIdsRef = useRef<Set<string>>(new Set(initialMessages.map((m) => m.id)))
    // Immutable snapshot of the restored ids (seenIdsRef grows) — the first-seen stamping
    // effect below skips these so a reload can't masquerade as the turns' send time.
    const restoredIdsRef = useRef<Set<string>>(new Set(initialMessages.map((m) => m.id)))
    // How many durable records the transcript we're RENDERING was built from — the exact test for
    // "has the server moved on?" (issue #5530). Message counts can't see a turn growing in place:
    // `transcriptToMessages` folds a paused turn into its resume and only closes a message on
    // `done`, so a mid-turn snapshot and the finished turn have the SAME count and a count-based
    // guard rejects the finished server copy forever. Cleared the moment a live turn starts, since
    // we can't know what the server logged for it — the next open then re-syncs from the log.
    const recordWatermarkRef = useRef<number | undefined>(
        store.get(sessionRecordCountsReadAtom)[sessionId],
    )
    // Durable sequence coverage is connection-local and must never be stored as a row count.
    const sequenceWatermarkRef = useRef<number | undefined>(undefined)
    // Whether the LAST assistant turn was user-stopped. You can only cancel the in-flight (last) turn,
    // so this is a single boolean gated on position at render time — independent of message ids (which
    // can be missing/duplicated in restore/error paths and would otherwise smear the tag onto every
    // turn). Cleared on the next send/resend.
    const [userStoppedState, dispatchStopped] = useReducer(
        reduceUserStoppedState,
        initialMessages,
        createUserStoppedState,
    )
    const stopped = userStoppedState.stopped
    const setStopped = useCallback(
        (next: boolean) => dispatchStopped({type: next ? "user-stop" : "reset"}),
        [],
    )
    const [stopPhase, dispatchStop] = useReducer(reduceStopPhase, "idle")

    const captureTurnRequest = useSetAtom(captureTurnRequestAtom)
    const revalidateSessionMounts = useSetAtom(revalidateSessionMountsAtom)
    const revalidateSessionRecords = useSetAtom(revalidateSessionRecordsAtom)
    const setSessionStatus = useSetAtom(setSessionStatusAtom)
    const recordInteractionAnswer = useSetAtom(recordInteractionAnswerAtom)
    const respondInteractionAnswer = useSetAtom(respondInteractionAnswerAtom)
    const respondInteractionAnswers = useSetAtom(respondInteractionAnswersAtom)
    const resumeSessionContinuation = useSetAtom(resumeSessionContinuationAtom)
    const supportsDurableApprovals = useSetAtom(sessionDurableApprovalsCapabilityAtom)
    const queryClient = useQueryClient()
    // Only a gate settled in this mount may trigger an automatic resume; hydrated answers stay inert.
    // `null` means "no live gate" — voided by a stop, or spent once a resume really went out;
    // `undefined` means "no live marker", which falls back to the predicate's tail heuristics.
    const liveGateInteractionRef = useRef<LiveAgentInteraction | null | undefined>(null)
    // Whether this mount is still on screen. The chat outlives it, so its callbacks need to tell
    // "still mine to report" from "running on in the background".
    const mountedRef = useRef(false)
    const messagesRef = useRef(initialMessages)
    const setTurnStartupLabel = useSetAtom(startTurnClockAtom)
    // Did the runner acknowledge THIS turn? Its acceptance frame is transient, so it reaches
    // `onData` and never the transcript — this is the only place the answer survives. A stream that
    // dies after it is a lost connection, not a lost turn; one that dies before it may be a send
    // that never started, and that failure has to stay on screen and in the cache.
    const turnAcceptedRef = useRef(acceptedRunBySession.has(sessionId))
    const acceptedExecutionIdRef = useRef<string | null>(
        acceptedRunBySession.get(sessionId) ?? null,
    )
    const [acceptedRunPending, setAcceptedRunPending] = useState(() =>
        acceptedRunBySession.has(sessionId),
    )
    const [turnDeliverySource, setTurnDeliverySource] = useState<TurnDeliverySource | null>(
        () => turnDeliverySourceBySession.get(sessionId) ?? null,
    )
    const settleSharedTurn = useCallback(
        (executionId?: string) => {
            const acceptedExecutionId = acceptedExecutionIdRef.current
            if (executionId && acceptedExecutionId && acceptedExecutionId !== executionId) return
            acceptedExecutionIdRef.current = null
            acceptedRunBySession.delete(sessionId)
            setAcceptedRunPending(false)
            turnDeliverySourceBySession.delete(sessionId)
            setTurnDeliverySource(null)
        },
        [sessionId],
    )
    const sharedSenderReadyRef = useRef(false)
    const setSharedSenderReady = useCallback((ready: boolean) => {
        sharedSenderReadyRef.current = ready
    }, [])
    const retryContinuation = useCallback(
        () => resumeSessionContinuation(sessionId),
        [resumeSessionContinuation, sessionId],
    )

    // Rebuilt every render and bound to the chat on every commit (below), so they always see the live
    // values — `entityId` included, which is why a run follows a revision switch or a self-commit
    // instead of sticking to the revision this session first mounted on.
    const hooks: SessionChatHooks = {
        prepareRequest: async ({messages, id}) => {
            return prepareAfterContinuationPreflight(
                resumeSessionContinuation,
                id ?? sessionId,
                async () => {
                    clearSessionTurnId(sessionId)
                    turnAcceptedRef.current = false
                    acceptedExecutionIdRef.current = null
                    acceptedRunBySession.delete(sessionId)
                    setAcceptedRunPending(false)
                    const sharedResponse = sharedSenderReadyRef.current
                    const deliverySource: TurnDeliverySource = sharedResponse ? "shared" : "legacy"
                    turnDeliverySourceBySession.set(sessionId, deliverySource)
                    setTurnDeliverySource(deliverySource)
                    // Bounded: retries while the invocation URL is still loading and rejects if
                    // the build hangs, so a failed send surfaces as an error bubble instead of an
                    // eternal spinner (#6042).
                    const req = await buildRequestWithinDeadline(() =>
                        buildAgentRequest(entityId, messages, {
                            sessionId: id ?? sessionId,
                            sharedResponse,
                        }),
                    )
                    captureTurnRequest(buildTurnCapture(req, generateId(), Date.now()))
                    return {api: req.invocationUrl, headers: req.headers, body: req.requestBody}
                },
            )
        },
        // ── #6047 startup states: capture the runner's observed startup boundary as it streams ──
        onData: (part) => {
            if (part.type === "data-session-accepted") {
                turnAcceptedRef.current = true
                const data = part.data as {executionId?: unknown} | undefined
                acceptedExecutionIdRef.current =
                    typeof data?.executionId === "string" ? data.executionId : null
                if (acceptedExecutionIdRef.current) {
                    setAcceptedSessionTurnId(sessionId, acceptedExecutionIdRef.current)
                }
                acceptedRunBySession.set(sessionId, acceptedExecutionIdRef.current)
                setAcceptedRunPending(true)
            }
            const label = startupLabelFromDataPart(part)
            if (label) setTurnStartupLabel(sessionId, label)
        },
        // Approve AND deny both resume — a deny-only decision must re-send so the runner
        // gets the denial round-trip and the model continues (no `approval-responded` limbo).
        // Side-effect-free on purpose: the SDK reads `predicate(...) && !isError`, so a `true` here
        // is a proposal it can still refuse. Consuming anything from inside would spend the gate on
        // a request that never left. The marker is consumed where a send is a fact — see the effect
        // on `status` below.
        sendAutomaticallyWhen: ({messages}) =>
            agentShouldResumeAfterApproval({
                messages,
                liveInteraction: liveGateInteractionRef.current,
            }),
        // The turn's trace may not be ingested yet when the row asks for its summary —
        // marking it fresh lets the trace queries retry through the ingestion lag
        // (historical traces get no such grace; a 404 there means the trace is gone).
        // A finished turn may also have written files: mark the session's drive data stale so
        // every mount surface (open or opened later) refetches — no live channel exists for this.
        // Liveness too: nothing else invalidates it at turn end, so the project-wide poll's cached
        // `is_running: true` outlived the answer by up to 15s (#5844). Safe to refetch immediately —
        // the runner awaits its `is_running: false` heartbeat BEFORE closing this stream
        // (services/runner/src/server.ts `aliveWatchdog.release()`), so the flag is already cleared.
        onFinish: ({
            message,
            messages: finishedMessages,
            finishReason,
            isAbort,
            isDisconnect,
            isError,
        }) => {
            // A clean shared invoke close is terminal; a disconnect still waits for the durable event.
            if (!isAbort && !isDisconnect && !isError) settleSharedTurn()
            dispatchStopped({
                type: "stream-terminal",
                messages: finishedMessages,
                finishReason,
            })
            markTraceAsFresh(getMessageTraceId(message))
            revalidateSessionMounts(sessionId)
            revalidateSessionRecords(sessionId)
            void queryClient.invalidateQueries({queryKey: ["session-liveness"]})
            // The first turn is what creates the durable session row; every later one changes its
            // title/preview/activity. Nothing else tells the session lists, so they discovered a
            // brand-new session only on their next poll or window refocus.
            invalidateSessionListQueries()
            // A preserved run settling with nobody mounted: this callback outlives the mount, so it
            // is what retires the session's run-state dot. A LIVE mount publishes its own status
            // (with error/awaiting precedence) from `busy`, so writing here would only flicker it.
            if (!mountedRef.current) setSessionStatus({id: sessionId, status: "idle"})
        },
        onError: () => {
            // Preserve null after resume/Stop; only a live marker may fall back to tail detection.
            if (liveGateInteractionRef.current !== null) {
                liveGateInteractionRef.current = undefined
            }
        },
    }

    // The registry owns the `Chat`, so re-entering the route re-binds to the SAME instance mid-turn
    // instead of aborting the run (#5724). The desktop preserves a chat for as long as its TAB is
    // open: a route change unmounts this conversation but leaves the tab, so the run follows the
    // user; the close/delete/archive/reset writers all commit before React runs the cleanup, so the
    // open-tab set is the authoritative answer by then.
    const scopeKey = useChatScopeKey()
    const chat = useSessionChat({
        sessionId,
        initialMessages,
        hooks,
        shouldPreserve: () => store.get(openSessionIdsAtomFamily(scopeKey)).has(sessionId),
    })

    const {
        messages,
        sendMessage: sendChatMessage,
        status,
        stop,
        regenerate: regenerateChatMessage,
        setMessages,
        addToolApprovalResponse,
        addToolOutput,
        error,
        clearError,
    } = useChat({
        chat,
        // Coalesce stream deltas to ~1 UI commit / 50ms so a fast token stream doesn't drive a
        // render per token; caps commit frequency independently of the per-commit memo win.
        experimental_throttle: 50,
    })

    const sendMessageWithFreshGuard: typeof sendChatMessage = useCallback(
        (...args: Parameters<typeof sendChatMessage>) => {
            clearSessionTurnId(sessionId)
            return sendChatMessage(...args)
        },
        [sendChatMessage, sessionId],
    )
    const regenerateWithFreshGuard: typeof regenerateChatMessage = useCallback(
        (...args: Parameters<typeof regenerateChatMessage>) => {
            clearSessionTurnId(sessionId)
            return regenerateChatMessage(...args)
        },
        [regenerateChatMessage, sessionId],
    )
    const lastMessage = messages[messages.length - 1]
    const serverErrorProvenance =
        lastMessage?.role === "assistant" &&
        lastMessage.parts.some((part) => part.type === "data-agent-error")
    const errorBoundary = useMemo(
        () =>
            error
                ? classifyAgentRunError(error, turnAcceptedRef.current, serverErrorProvenance)
                : {},
        [error, serverErrorProvenance],
    )

    const busy = isChatBusy(status)
    // `messages`/`busy` change every token; consumers that must stay referentially stable
    // (`handleRewind`, the hydration/SWR adoption guards) read them through refs instead.
    messagesRef.current = messages
    const busyRef = useRef(busy || acceptedRunPending)
    busyRef.current = busy || acceptedRunPending

    useEffect(() => {
        dispatchStopped({type: "transcript", messages})
    }, [messages])

    // Mid-stream drive signals: settled write-ish tool calls append file-activity entries (and
    // throttle-revalidate the drives) as the turn streams, not just at onFinish.
    useFileActivityDetector({sessionId, messages})

    // Server-side platform ops (create_schedule, …) stale the client cache with no other signal.
    useToolCacheInvalidation({sessionId, messages})

    const {
        isHydrating,
        hydratedEmpty,
        runningElsewhere,
        stopStateLoading,
        sessionTurnId,
        stoppingTurnId,
        sharedReaderAdvertised,
        refreshFromRecords,
        revalidate,
    } = useSessionHydration({
        sessionId,
        initialMessages,
        messagesRef,
        busyRef,
        seenIdsRef,
        restoredIdsRef,
        recordWatermarkRef,
        sequenceWatermarkRef,
        busy,
        setMessages,
        persistMessages,
        clearRunError: clearError,
        intent,
        pendingResumeRef: liveGateInteractionRef,
    })
    const stopping =
        isStoppingPhase(stopPhase) ||
        isSessionTurnStopping({
            currentTurnId: sessionTurnId ?? latestTurnId(messages),
            stoppingTurnId,
        }) ||
        (stopStateLoading && isHitlPending(messages))

    // A decision made in THIS mount marks the resume as live — a restored approval-requested tail
    // the user answers after a reload genuinely auto-resumes, so the queue's pre-resume hold applies.
    const markLiveGate = useCallback((interaction: LiveAgentInteraction) => {
        liveGateInteractionRef.current = interaction
    }, [])

    /** Choose the durable dispatcher only when the server advertises it. */
    const answerApproval = useCallback(
        async (approvalId: string, approved: boolean) => {
            return submitApprovalForCapability({
                durableApprovals: await supportsDurableApprovals(sessionId),
                submitDurable: () =>
                    respondInteractionAnswer({
                        sessionId,
                        toolCallId: approvalId,
                        approved,
                    }),
                retireDurable: () => {
                    // A lost HTTP response may still follow a committed continuation.
                    liveGateInteractionRef.current = null
                },
                recordLegacy: () =>
                    recordInteractionAnswer({
                        sessionId,
                        toolCallId: approvalId,
                        resolution: approvalResolution(approvalId, approved),
                    }),
                releaseLegacy: () => addToolApprovalResponse({id: approvalId, approved}),
            })
        },
        [
            addToolApprovalResponse,
            recordInteractionAnswer,
            respondInteractionAnswer,
            sessionId,
            supportsDurableApprovals,
        ],
    )

    const answerApprovals = useCallback(
        async (toolCallIds: string[], approved: boolean) => {
            return submitApprovalForCapability({
                durableApprovals: await supportsDurableApprovals(sessionId),
                submitDurable: () => respondInteractionAnswers({sessionId, toolCallIds, approved}),
                retireDurable: () => {
                    liveGateInteractionRef.current = null
                },
                recordLegacy: () =>
                    Promise.all(
                        toolCallIds.map((approvalId) =>
                            recordInteractionAnswer({
                                sessionId,
                                toolCallId: approvalId,
                                resolution: approvalResolution(approvalId, approved),
                            }),
                        ),
                    ).then(() => undefined),
                releaseLegacy: () => {
                    for (const id of toolCallIds) addToolApprovalResponse({id, approved})
                },
            })
        },
        [
            addToolApprovalResponse,
            recordInteractionAnswer,
            respondInteractionAnswers,
            sessionId,
            supportsDurableApprovals,
        ],
    )

    // A resume really went out (the SDK's), so the gate it carried is spent. Retired HERE, where a
    // send is a fact, and never in the predicate, whose `true` the SDK can still refuse.
    const previousStatusRef = useRef(status)
    useEffect(() => {
        const from = previousStatusRef.current
        previousStatusRef.current = status
        if (isResumeSend({from, to: status})) liveGateInteractionRef.current = null
    }, [status])

    // Settle a parked client tool (#4920). The dispatcher calls this from a widget (e.g. the connect
    // widget) with the structured reference; `addToolOutput` matches the part by `toolCallId` on the
    // last turn and the resume predicate auto-resends. `tool` is only the typed-tools key — matching
    // is by id — so a cast onto the untyped UIMessage tool map is safe.
    const handleClientToolOutput = useCallback<ClientToolOutputHandler>(
        ({toolName, toolCallId, output, errorText}) => {
            // Set synchronously: it holds off transcript adoption for the whole ordered window.
            liveGateInteractionRef.current = {kind: "client_tool", id: toolCallId}
            // Ordered, not raced — the resume starts a turn whose sweep cancels every `pending`
            // row, so the answer has to be durable first. Capped inside the helper.
            void recordAnswerThenRelease({
                record: () =>
                    recordInteractionAnswer({
                        sessionId,
                        toolCallId,
                        resolution: {
                            tool_call_id: toolCallId,
                            tool_name: toolName,
                            ...(errorText !== undefined
                                ? {outcome: "error", error: errorText}
                                : {outcome: "completed", output: output ?? {}}),
                        },
                    }),
                release: () => {
                    if (errorText !== undefined) {
                        addToolOutput({
                            state: "output-error",
                            tool: toolName as never,
                            toolCallId,
                            errorText,
                        }).catch(ignoreStreamRejection)
                    } else {
                        addToolOutput({
                            tool: toolName as never,
                            toolCallId,
                            output: (output ?? {}) as never,
                        }).catch(ignoreStreamRejection)
                    }
                },
            })
        },
        [addToolOutput, recordInteractionAnswer, sessionId],
    )

    // Orphan detection for the queue's pre-resume hold: the tail is a RESTORED message (this
    // mount never streamed it) shaped like "auto-resume imminent", and no gate was settled live
    // in this mount. The SDK only evaluates `sendAutomaticallyWhen` on live events (approval
    // response, tool output, stream finish) — never on mount — so this resume can't fire and
    // must not hold the queue. Short-circuits cheap on the streaming hot path: any live send
    // makes the tail non-restored.
    const resumeOrphaned =
        !liveGateInteractionRef.current &&
        !!lastMessage &&
        restoredIdsRef.current.has(lastMessage.id) &&
        agentShouldResumeAfterApproval({messages})

    // Cache only the newest turn id observed by this page for guarded Stop.
    useEffect(() => {
        const turnId = latestTurnId(messages)
        if (turnId) setSessionTurnId(sessionId, turnId)
    }, [messages, sessionId])

    // Run failures become conversation content; an accepted transport loss stays connection state.
    useEffect(() => {
        const parsed = errorBoundary.runError
        if (!parsed) return
        const stamp: RunErrorMetadata = {runError: parsed}
        setMessages((prev) => {
            const last = prev.length > 0 ? prev[prev.length - 1] : undefined
            const existing = (last?.metadata as RunErrorMetadata | undefined)?.runError
            if (last?.role === "assistant") {
                if (existing?.message === parsed.message) return prev // already stamped
                const next = [...prev]
                next[next.length - 1] = {
                    ...last,
                    metadata: {...(last.metadata as object | undefined), ...stamp},
                }
                return next
            }
            // No trailing assistant turn (failed before one existed) — add a minimal carrier.
            return [
                ...prev,
                {
                    id: `run-error-${generateId()}`,
                    role: "assistant",
                    parts: [],
                    metadata: stamp,
                } as (typeof prev)[number],
            ]
        })
    }, [errorBoundary.runError, setMessages])

    // A live turn makes the transcript no longer a copy of the server's, and we can't know how many
    // records the runner logged for it — so drop the watermark and let the next open re-sync from
    // the durable log. MUST stay declared above the persist effect: on the commit where `status`
    // flips to "submitted", effects run in declaration order, so clearing here is what stops the
    // persist below from filing a locally-extended transcript under a server watermark.
    useEffect(() => {
        if (isChatBusy(status)) {
            recordWatermarkRef.current = undefined
            sequenceWatermarkRef.current = undefined
        }
    }, [status])

    // Persist the conversation whenever its stream settles (skip mid-stream).
    useEffect(() => {
        if (status === "streaming") return
        persistMessages({
            id: sessionId,
            messages: withoutSharedSenderAcceptanceMessages(messages),
            recordCount: recordWatermarkRef.current,
        })
    }, [messages, status, sessionId, persistMessages])

    // ── #6047 startup states: one label per in-flight turn ──
    const clearTurnClock = useSetAtom(clearTurnClockAtom)
    useEffect(() => {
        // Until the runner reports an observed startup boundary, both cold and warm turns use dots.
        if (status === "submitted") {
            clearTurnClock(sessionId)
            return
        }
        // `streaming` is the same turn continuing — leave its clock alone.
        if (status === "streaming") return
        // Every terminal path lands here — answered, errored, and stopped all leave these two
        // states — so a failed or cancelled run can't strand a stale startup label.
        clearTurnClock(sessionId)
    }, [status, sessionId, setTurnStartupLabel, clearTurnClock])

    // Bound the in-message expand-state store: on settle, drop entries whose owning message is gone
    // (rewound / evicted / closed). Live = every open session's persisted messages ∪ this active one.
    // `store.get` reads without subscribing, so this never adds re-renders on the streaming hot path.
    const pruneExpanded = useSetAtom(pruneExpandedAtom)
    useEffect(() => {
        if (status === "streaming") return
        const persisted = store.get(sessionMessagesAtom)
        const live = new Set<string>()
        for (const sid in persisted)
            for (const key of expandedKeysForMessages(persisted[sid])) live.add(key)
        for (const key of expandedKeysForMessages(messages)) live.add(key)
        pruneExpanded(live)
    }, [messages, status, store, pruneExpanded])

    // Stamp a first-seen timestamp on any newly-appeared LIVE message (user + assistant).
    // Restored rows are excluded: their first-seen is the reload moment, not the turn's time —
    // stamping them made old turns read "just now" until (or forever if) the trace never loads.
    // Unstamped, their timestamp slot shows a pending placeholder, then the trace's real time.
    useEffect(() => {
        stampMessagesCreatedAt(
            messages.filter((m) => !restoredIdsRef.current.has(m.id)).map((m) => m.id),
        )
    }, [messages, stampMessagesCreatedAt])

    // ── #4920 Application 1: refresh the config on a committed revision ──
    // When the agent commits a new revision of itself, the backend emits a one-way
    // `data-committed-revision` part (same channel as `data-trace`), whether the tool asked first
    // or ran directly. On receipt we invalidate the latest-revision and
    // inspect caches so the config panel, section drawers, and build-kit view all re-read the new
    // config. Deduped by revision id so a re-render (token stream) doesn't re-invalidate.
    const committedRevisionsSeenRef = useRef<Set<string>>(new Set())
    const setAgentCommitSignal = useSetAtom(agentSelfCommitSignalAtom)
    useEffect(() => {
        for (const message of messages) {
            for (const part of message.parts) {
                if ((part as {type?: string}).type !== "data-committed-revision") continue
                const data = (part as {data?: {revisionId?: string; version?: string}}).data
                // A stable key per commit: prefer the revision id, fall back to the whole payload.
                const key = data?.revisionId ?? JSON.stringify(data ?? {}) ?? "committed"
                if (committedRevisionsSeenRef.current.has(key)) continue
                committedRevisionsSeenRef.current.add(key)
                invalidateAgentCommittedRevisionCache()
                if (data?.revisionId && data.revisionId !== entityId) {
                    // Capture the OUTGOING revision's parameters before switching, so the config
                    // panel can show what the agent changed (per-section indicators + summary).
                    const prevParameters = store.get(
                        workflowMolecule.selectors.configuration(entityId),
                    )
                    setAgentCommitSignal({
                        revisionId: data.revisionId,
                        version: data.version,
                        prevParameters: prevParameters ?? null,
                        at: Date.now(),
                    })
                    switchEntity({currentEntityId: entityId, newEntityId: data.revisionId})
                }
            }
        }
    }, [messages, entityId, switchEntity, store, setAgentCommitSignal])

    const projectId = useAtomValue(projectIdAtom)
    const expectedStopExecutionIdRef = useRef<string | undefined>(undefined)
    const retryStopRef = useRef(false)
    const abortAfterAcceptedRef = useRef(false)
    const stopResolutionRef = useRef<AbortController | null>(null)
    const stopAttemptRef = useRef(0)

    useEffect(() => {
        stopAttemptRef.current += 1
        dispatchStop({type: "reset"})
        retryStopRef.current = false
        abortAfterAcceptedRef.current = false
        expectedStopExecutionIdRef.current = undefined
        return () => {
            stopResolutionRef.current?.abort()
        }
    }, [sessionId])

    const handleStop = useCallback(() => {
        if (stopping) return
        // Fence delayed approval release even when cancellation cannot be requested yet.
        liveGateInteractionRef.current = null
        const wasParked = !busyRef.current && isHitlPending(messagesRef.current)
        const stopAttempt = ++stopAttemptRef.current
        dispatchStop({type: "request"})
        if (!projectId || !sessionId) {
            dispatchStop({type: "failed"})
            message.warning("Could not stop the run. It may still be running.")
            return
        }
        // Opt-in hard kill (NEXT_PUBLIC_AGENT_CHAT_STOP_KILLS_SESSION): tear the whole session down.
        if (doesAgentChatStopKillSession()) {
            killSession({sessionId, projectId})
                .then((ok) => {
                    if (stopAttemptRef.current !== stopAttempt) return
                    if (ok) {
                        dispatchStop(
                            wasParked ? {type: "cancelled", parked: true} : {type: "accepted"},
                        )
                        queryClient.invalidateQueries({queryKey: ["session-liveness"]})
                        // Refresh an open Inspector so it reflects the kill immediately.
                        void invalidateSessionInspector(queryClient, sessionId)
                    } else {
                        dispatchStop({type: "failed"})
                        message.warning("Could not stop the run. It may still be running.")
                    }
                })
                .catch((error: unknown) => {
                    if (stopAttemptRef.current !== stopAttempt) return
                    dispatchStop({type: "failed"})
                    message.warning(
                        error instanceof Error
                            ? error.message
                            : "Could not stop the run. It may still be running.",
                    )
                })
            return
        }
        // Keep the stream attached until a terminal event confirms accepted cancellation.
        const isRetry = retryStopRef.current
        const expectedExecutionId = isRetry
            ? expectedStopExecutionIdRef.current
            : getSessionTurnId(sessionId)
        retryStopRef.current = false
        abortAfterAcceptedRef.current = isRetry
        const cancel = async () => {
            let resolvedExecutionId = expectedExecutionId
            if (!isRetry && !resolvedExecutionId && busyRef.current) {
                const controller = new AbortController()
                stopResolutionRef.current?.abort()
                stopResolutionRef.current = controller
                const resolution = await resolveStopExecution({
                    readExecutionId: () => getSessionTurnId(sessionId),
                    isRunActive: () => busyRef.current,
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
                if (stopAttemptRef.current !== stopAttempt) return
                if ("resolution" in result && result.resolution) {
                    if (result.resolution.status === "settled") {
                        dispatchStop({type: "terminal"})
                    } else if (result.resolution.status === "timed_out") {
                        dispatchStop({type: "failed"})
                        message.warning("Could not identify the run to stop. Please try again.")
                    }
                    return
                }
                const {outcome} = result
                void invalidateSessionInspector(queryClient, sessionId)
                if (outcome?.accepted) {
                    dispatchStop({type: "cancelled", parked: wasParked})
                    const legacyStopSettled = outcome.execution.state === "idle"
                    if (legacyStopSettled || abortAfterAcceptedRef.current) {
                        stop()
                        dispatchStop({type: "terminal"})
                    }
                    queryClient.invalidateQueries({queryKey: ["session-liveness"]})
                    return
                }
                if (outcome && !outcome.conflict && outcome.execution.state === "idle") {
                    abortAfterAcceptedRef.current = false
                    expectedStopExecutionIdRef.current = undefined
                    dispatchStop({type: "already_idle"})
                    queryClient.invalidateQueries({queryKey: ["session-liveness"]})
                    return
                }
                if (outcome?.conflict) {
                    retryStopRef.current = false
                    expectedStopExecutionIdRef.current = undefined
                } else if (abortAfterAcceptedRef.current) {
                    retryStopRef.current = true
                }
                abortAfterAcceptedRef.current = false
                dispatchStop({type: "failed"})
                message.warning(
                    outcome?.conflict
                        ? "That run had already finished. The session is running something else now."
                        : "Could not stop the run. It may still be running.",
                )
                queryClient.invalidateQueries({queryKey: ["session-liveness"]})
            })
            .catch((error: unknown) => {
                if (stopAttemptRef.current !== stopAttempt) return
                stopResolutionRef.current = null
                if (abortAfterAcceptedRef.current) retryStopRef.current = true
                abortAfterAcceptedRef.current = false
                dispatchStop({type: "failed"})
                message.warning(
                    error instanceof Error
                        ? error.message
                        : "Could not stop the run. It may still be running.",
                )
            })
    }, [stopping, projectId, sessionId, queryClient, stop])

    useEffect(() => {
        if (stopPhase !== "accepted") return
        const timer = setTimeout(() => {
            retryStopRef.current = true
            abortAfterAcceptedRef.current = false
            dispatchStop({type: "timeout"})
        }, 30_000)
        return () => clearTimeout(timer)
    }, [stopPhase])

    const previousBusyRef = useRef(busy)
    useEffect(() => {
        const wasBusy = previousBusyRef.current
        previousBusyRef.current = busy
        if (wasBusy && !busy) {
            retryStopRef.current = false
            dispatchStop({type: "terminal"})
        }
        if (!wasBusy && busy) dispatchStop({type: "reset"})
    }, [busy])

    useEffect(() => {
        if (stopPhase !== "stopped") return
        const last = messagesRef.current[messagesRef.current.length - 1]
        if (last?.role === "assistant") setStopped(true)
        retryStopRef.current = false
        abortAfterAcceptedRef.current = false
        expectedStopExecutionIdRef.current = undefined
        dispatchStop({type: "reset"})
    }, [stopPhase])

    // ── D9 teardown: `useSessionChat` releases the claim; this tracks what it does not own ──
    // The startup clock only goes with the session when the session itself is gone — clearing it
    // unconditionally would blank a still-open tab's label when its stream is merely following the
    // user to another route (#5724, #6047).
    useEffect(() => {
        // Set on SETUP, not at declaration: StrictMode's dev cycle tears this effect down and runs
        // it again on the same mount, and the flag has to come back with it.
        mountedRef.current = true
        return () => {
            mountedRef.current = false
            if (!store.get(openSessionIdsAtomFamily(scopeKey)).has(sessionId)) {
                clearTurnClock(sessionId)
            }
        }
    }, [sessionId, scopeKey, store, clearTurnClock])

    // After each commit, mark on-screen messages as seen so they don't re-animate on later renders
    // (e.g. streaming tokens). Done in an effect, not during render, so StrictMode's double invoke
    // doesn't mark a brand-new message before its first paint and rob it of the fade.
    useEffect(() => {
        for (const m of messages) seenIdsRef.current.add(m.id)
    }, [messages])

    /** Has this id already been painted? Drives the one-shot fade-in on a live turn. */
    const isSeen = useCallback((id: string) => seenIdsRef.current.has(id), [])

    return {
        messages,
        status,
        busy,
        error: errorBoundary.runError,
        connectionWarning: errorBoundary.connectionWarning,
        acceptedRunPending,
        turnDeliverySource,
        settleSharedTurn,
        sendMessage: sendMessageWithFreshGuard,
        regenerate: regenerateWithFreshGuard,
        setMessages,
        addToolApprovalResponse,
        messagesRef,
        busyRef,
        isHydrating,
        hydratedEmpty,
        runningElsewhere,
        sharedReaderAdvertised,
        refreshFromRecords,
        setSharedSenderReady,
        revalidate,
        stopped,
        stopping,
        setStopped,
        handleStop,
        handleClientToolOutput,
        markLiveGate,
        answerApproval,
        answerApprovals,
        retryContinuation,
        resumeOrphaned,
        isSeen,
    }
}
