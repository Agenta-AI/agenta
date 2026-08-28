import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    buildRequestWithinDeadline,
    getMessageTraceId,
    startupLabelFromDataPart,
} from "@agenta/chat/assets"
import type {ClientToolOutputHandler} from "@agenta/chat/clientTools"
import {ignoreStreamRejection, parseAgentRunError} from "@agenta/chat/model"
import {
    clearTurnClockAtom,
    stampMessagesCreatedAtAtom,
    startTurnClockAtom,
} from "@agenta/chat/state"
import {expandedKeysForMessages, pruneExpandedAtom} from "@agenta/chat/state"
import {
    persistSessionMessagesAtom,
    sessionMessagesAtom,
    sessionRecordCountsReadAtom,
} from "@agenta/chat/state"
import {AgentChatTransport} from "@agenta/chat/transport"
import {
    commandSessionStream,
    invalidateSessionListQueries,
    killSession,
    recordInteractionAnswerAtom,
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
    isResumeSend,
    playgroundController,
    recordAnswerThenRelease,
    type LiveAgentInteraction,
} from "@agenta/playground"
import {agentSelfCommitSignalAtom} from "@agenta/shared/state"
import {generateId} from "@agenta/shared/utils"
import {useChat} from "@ai-sdk/react"
import {useQueryClient} from "@tanstack/react-query"
import {type UIMessage} from "ai"
import {useAtomValue, useSetAtom, useStore} from "jotai"

import {projectIdAtom} from "@/oss/state/project"

import {doesAgentChatStopKillSession} from "../assets/constants"
import {invalidateSessionInspector} from "../components/Inspector/invalidate"
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
 * Design decisions baked in (docs/design/agent-workflows/playground-agent-generation.md):
 *  - D9  teardown: abort the in-flight stream on unmount (tab close / revision swap).
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
    // Whether the LAST assistant turn was user-stopped. You can only cancel the in-flight (last) turn,
    // so this is a single boolean gated on position at render time — independent of message ids (which
    // can be missing/duplicated in restore/error paths and would otherwise smear the tag onto every
    // turn). Cleared on the next send/resend.
    const [stopped, setStopped] = useState(false)

    // `useChat` pins its `Chat` (and thus this transport) for the life of the session `id`; it is
    // NOT recreated when `entityId` changes (only on an `id` change). So the request builder must
    // read the CURRENT entity through a ref — capturing `entityId` by value would send every turn
    // with the revision that was displayed when the session first mounted, even after a switch or a
    // self-commit. Reading `entityIdRef.current` at send time keeps runs on the live revision.
    const entityIdRef = useRef(entityId)
    entityIdRef.current = entityId

    // Turn Inspector capture write, read via ref so the transport `useMemo` doesn't depend on it.
    const captureTurnRequest = useSetAtom(captureTurnRequestAtom)
    const captureRef = useRef(captureTurnRequest)
    captureRef.current = captureTurnRequest

    // Transport feeds the v6 stream request from the playground pipeline. `api` here is a
    // placeholder that `prepareSendMessagesRequest` overrides per request.
    const transport = useMemo(
        () =>
            new AgentChatTransport({
                api: "",
                prepareSendMessagesRequest: async ({messages, id}) => {
                    // Bounded: retries while the invocation URL is still loading and rejects if
                    // the build hangs, so a failed send surfaces as an error bubble instead of an
                    // eternal spinner (#6042).
                    const req = await buildRequestWithinDeadline(() =>
                        buildAgentRequest(entityIdRef.current, messages, {
                            sessionId: id ?? sessionId,
                        }),
                    )
                    captureRef.current(buildTurnCapture(req, generateId(), Date.now()))
                    return {api: req.invocationUrl, headers: req.headers, body: req.requestBody}
                },
            }),
        [sessionId],
    )

    const revalidateSessionMounts = useSetAtom(revalidateSessionMountsAtom)
    const revalidateSessionRecords = useSetAtom(revalidateSessionRecordsAtom)
    const recordInteractionAnswer = useSetAtom(recordInteractionAnswerAtom)
    const queryClient = useQueryClient()
    // Only a gate settled in this mount may trigger an automatic resume; hydrated answers stay inert.
    // `null` means "no live gate" — voided by a stop, or spent once a resume really went out;
    // `undefined` means "no live marker", which falls back to the predicate's tail heuristics.
    const liveGateInteractionRef = useRef<LiveAgentInteraction | null | undefined>(null)
    const setTurnStartupLabel = useSetAtom(startTurnClockAtom)

    const {
        messages,
        sendMessage,
        status,
        stop,
        regenerate,
        setMessages,
        addToolApprovalResponse,
        addToolOutput,
        error,
    } = useChat({
        id: sessionId,
        messages: initialMessages,
        transport,
        // Coalesce stream deltas to ~1 UI commit / 50ms so a fast token stream doesn't drive a
        // render per token; caps commit frequency independently of the per-commit memo win.
        experimental_throttle: 50,
        onData: (part) => {
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
        onFinish: ({message}) => {
            markTraceAsFresh(getMessageTraceId(message))
            revalidateSessionMounts(sessionId)
            revalidateSessionRecords(sessionId)
            void queryClient.invalidateQueries({queryKey: ["session-liveness"]})
            // The first turn is what creates the durable session row; every later one changes its
            // title/preview/activity. Nothing else tells the session lists, so they discovered a
            // brand-new session only on their next poll or window refocus.
            invalidateSessionListQueries()
        },
        onError: (err) => {
            // Clear the marker but do NOT void the resume. A gateway approval is answered while the
            // stream is still open, so the SDK skips its own dispatch and only re-evaluates when the
            // stream ends — often by erroring, right here. `null` made that last evaluation return
            // false and stranded the answer; `undefined` lets the tail heuristics decide.
            // Adoption is unaffected: the hydration guard reads this ref as a boolean.
            liveGateInteractionRef.current = undefined
            // Render the error in-chat (the `error` alert below); swallow it here so an
            // aborted/errored stream doesn't bubble unhandled to the Next.js dev overlay (F-033).
            console.warn("[AgentChatPanel] useChat error (rendered in-chat):", err)
        },
    })

    const busy = status === "submitted" || status === "streaming"

    // `messages`/`busy` change every token; consumers that must stay referentially stable
    // (`handleRewind`, the hydration/SWR adoption guards) read them through refs instead.
    const messagesRef = useRef(messages)
    messagesRef.current = messages
    const busyRef = useRef(busy)
    busyRef.current = busy

    // Mid-stream drive signals: settled write-ish tool calls append file-activity entries (and
    // throttle-revalidate the drives) as the turn streams, not just at onFinish.
    useFileActivityDetector({sessionId, messages})

    // Server-side platform ops (create_schedule, …) stale the client cache with no other signal.
    useToolCacheInvalidation({sessionId, messages})

    const {isHydrating, hydratedEmpty, runningElsewhere} = useSessionHydration({
        sessionId,
        initialMessages,
        messagesRef,
        busyRef,
        seenIdsRef,
        restoredIdsRef,
        recordWatermarkRef,
        busy,
        setMessages,
        persistMessages,
        intent,
        pendingResumeRef: liveGateInteractionRef,
    })

    // A decision made in THIS mount marks the resume as live — a restored approval-requested tail
    // the user answers after a reload genuinely auto-resumes, so the queue's pre-resume hold applies.
    const markLiveGate = useCallback((interaction: LiveAgentInteraction) => {
        liveGateInteractionRef.current = interaction
    }, [])

    /**
     * Answer an approval: record the decision on the row the runner parked, THEN flip the part.
     *
     * Ordered, not raced. This hook dispatches no resume of its own — the park stream ends with a
     * clean finish, so the SDK's `sendAutomaticallyWhen` sends it — but the flip is what lets the
     * SDK dispatch, and that resume's stale sweep cancels rows still `pending`, this one included.
     * Released early, the sweep reached the API first and cancelled the row being answered.
     */
    const answerApproval = useCallback(
        (approvalId: string, approved: boolean) =>
            recordAnswerThenRelease({
                record: () =>
                    recordInteractionAnswer({
                        sessionId,
                        toolCallId: approvalId,
                        resolution: approvalResolution(approvalId, approved),
                    }),
                release: () => addToolApprovalResponse({id: approvalId, approved}),
            }),
        [addToolApprovalResponse, recordInteractionAnswer, sessionId],
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
    const lastMessage = messages[messages.length - 1]
    const resumeOrphaned =
        !liveGateInteractionRef.current &&
        !!lastMessage &&
        restoredIdsRef.current.has(lastMessage.id) &&
        agentShouldResumeAfterApproval({messages})

    // Surface a stream failure inline: stamp the parsed error onto the failing assistant turn so
    // it renders as a red error bubble with the real reason (and persists with the session via the
    // effect below), instead of a transient top banner + a generic "no response". FE-only — it
    // uses the error useChat already has; the backend doesn't need to attach it to the trace.
    useEffect(() => {
        if (!error) return
        const parsed = parseAgentRunError(error)
        setMessages((prev) => {
            const last = prev.length > 0 ? prev[prev.length - 1] : undefined
            const existing = (last?.metadata as {runError?: {message?: string}} | undefined)
                ?.runError
            if (last?.role === "assistant") {
                if (existing?.message === parsed.message) return prev // already stamped
                const next = [...prev]
                next[next.length - 1] = {
                    ...last,
                    metadata: {...(last.metadata as object | undefined), runError: parsed},
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
                    metadata: {runError: parsed},
                } as (typeof prev)[number],
            ]
        })
    }, [error, setMessages])

    // A live turn makes the transcript no longer a copy of the server's, and we can't know how many
    // records the runner logged for it — so drop the watermark and let the next open re-sync from
    // the durable log. MUST stay declared above the persist effect: on the commit where `status`
    // flips to "submitted", effects run in declaration order, so clearing here is what stops the
    // persist below from filing a locally-extended transcript under a server watermark.
    useEffect(() => {
        if (status === "submitted" || status === "streaming") recordWatermarkRef.current = undefined
    }, [status])

    // Persist the conversation whenever its stream settles (skip mid-stream).
    useEffect(() => {
        if (status === "streaming") return
        persistMessages({id: sessionId, messages, recordCount: recordWatermarkRef.current})
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

    // ── DT3 cancelled state: wrap stop() to mark the in-flight assistant turn ──
    const markStopped = useCallback(() => {
        const last = messages[messages.length - 1]
        if (last && last.role === "assistant") setStopped(true)
    }, [messages])

    const projectId = useAtomValue(projectIdAtom)

    const handleStop = useCallback(() => {
        markStopped()
        // A stop voids the pending gate (same rule the queue applies), so the marker must go too —
        // otherwise it outlives the abandoned resume and blocks this mount's records adoption.
        liveGateInteractionRef.current = null
        stop() // abort the client stream immediately
        if (!projectId || !sessionId) return
        // Opt-in hard kill (NEXT_PUBLIC_AGENT_CHAT_STOP_KILLS_SESSION): tear the whole session down.
        if (doesAgentChatStopKillSession()) {
            killSession({sessionId, projectId})
                .then((ok) => {
                    if (ok) {
                        queryClient.invalidateQueries({queryKey: ["session-liveness"]})
                        // Refresh an open Inspector's Runtime lens so its Lifecycle/State reflect the
                        // kill immediately (mirrors the panel's own Kill button).
                        void invalidateSessionInspector(queryClient, sessionId)
                    }
                })
                .catch(() => {})
            return
        }
        // Default Stop: cooperatively cancel the CURRENT TURN. The control-plane `cancel` command
        // (no inputs, no force) drops the alive lock; the runner closes the turn as interrupted and
        // the session STAYS OPEN so a follow-up prompt resumes it — instead of the old behaviour where
        // the client stream aborted but the runner kept running and billing.
        commandSessionStream({sessionId, projectId}).catch(() => {})
    }, [markStopped, stop, projectId, sessionId, queryClient])

    // ── D9 teardown: abort the in-flight stream on unmount (tab close / revision swap) ──
    // Keyed on sessionId: closing a tab or swapping the revision unmounts this conversation
    // and should tear down its stream.
    // The clock goes with it: a turn torn down mid-flight leaves an entry no one clears, and a
    // later remount would then read a start time from a turn that is long gone.
    useEffect(() => {
        return () => {
            stop()
            clearTurnClock(sessionId)
        }
    }, [sessionId, stop, clearTurnClock])

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
        error,
        sendMessage,
        regenerate,
        setMessages,
        addToolApprovalResponse,
        messagesRef,
        busyRef,
        isHydrating,
        hydratedEmpty,
        runningElsewhere,
        stopped,
        setStopped,
        handleStop,
        handleClientToolOutput,
        markLiveGate,
        answerApproval,
        resumeOrphaned,
        isSeen,
    }
}
