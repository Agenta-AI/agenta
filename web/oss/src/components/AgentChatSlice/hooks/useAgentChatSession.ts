import {useCallback, useEffect, useRef, useState} from "react"

import {
    commandSessionStream,
    killSession,
    revalidateSessionMountsAtom,
    revalidateSessionRecordsAtom,
} from "@agenta/entities/session"
import {markTraceAsFresh} from "@agenta/entities/trace"
import {invalidateAgentCommittedRevisionCache, workflowMolecule} from "@agenta/entities/workflow"
import {
    agentShouldResumeAfterApproval,
    buildAgentRequest,
    buildTurnCapture,
    playgroundController,
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
import {ignoreStreamRejection, parseAgentRunError} from "../assets/runError"
import {getMessageTraceId} from "../assets/trace"
import type {ClientToolOutputHandler} from "../components/clientTools"
import {invalidateSessionInspector} from "../components/Inspector/invalidate"
import {acquireSessionChat, isChatBusy, releaseSessionChat} from "../state/chatRegistry"
import {expandedKeysForMessages, pruneExpandedAtom} from "../state/expandState"
import {useChatScopeKey} from "../state/scope"
import {
    openSessionIdsAtomFamily,
    persistSessionMessagesAtom,
    sessionMessagesAtom,
    sessionRecordCountsReadAtom,
    stampMessagesCreatedAtAtom,
} from "../state/sessions"
import {captureTurnRequestAtom} from "../state/turnCaptures"

import {useFileActivityDetector} from "./useFileActivityDetector"
import {type ScrollIntent} from "./useScrollIntent"
import {useSessionHydration} from "./useSessionHydration"

/**
 * The chat stream for one session tab: transport, `useChat`, and every side effect that belongs to
 * the conversation itself — history hydration, persistence, error stamping, self-commit pickup,
 * stop/kill, and teardown. Everything the UI layers on top (queue, approvals, onboarding, the
 * composer) consumes this hook's return rather than reaching for `useChat` directly.
 *
 * Design decisions baked in (docs/design/agent-workflows/playground-agent-generation.md):
 *  - D9  teardown: release the chat on unmount; `state/chatRegistry` owns the instance and decides
 *        whether to preserve it (#5724).
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

    const captureTurnRequest = useSetAtom(captureTurnRequestAtom)
    const revalidateSessionMounts = useSetAtom(revalidateSessionMountsAtom)
    const revalidateSessionRecords = useSetAtom(revalidateSessionRecordsAtom)
    // Only a gate settled in this mount may trigger an automatic resume; hydrated answers stay inert.
    const liveGateInteractionRef = useRef<LiveAgentInteraction | null>(null)

    // The registry owns the `Chat`, so re-entering the route re-binds to the SAME instance mid-turn
    // instead of aborting the run (#5724). It rebinds these callbacks on every render, so they always
    // see the live values — `entityId` included, which is why a run follows a revision switch or a
    // self-commit instead of sticking to the revision this session first mounted on.
    const chat = acquireSessionChat({
        sessionId,
        initialMessages,
        hooks: {
            prepareRequest: async ({messages, id}) => {
                const req = await buildAgentRequest(entityId, messages, {
                    sessionId: id ?? sessionId,
                })
                if (!req) {
                    throw new Error(
                        "This agent workflow has no invocation URL — it can’t be run yet.",
                    )
                }
                captureTurnRequest(buildTurnCapture(req, generateId(), Date.now()))
                return {api: req.invocationUrl, headers: req.headers, body: req.requestBody}
            },
            // Approve AND deny both resume — a deny-only decision must re-send so the runner gets
            // the denial round-trip and the model continues (no `approval-responded` limbo).
            sendAutomaticallyWhen: ({messages}) => {
                const shouldDispatch = agentShouldResumeAfterApproval({
                    messages,
                    liveInteraction: liveGateInteractionRef.current,
                })
                if (shouldDispatch) liveGateInteractionRef.current = null
                return shouldDispatch
            },
            // The turn's trace may not be ingested yet when the row asks for its summary — marking
            // it fresh lets the trace queries retry through the ingestion lag. A finished turn may
            // also have written files, so mark the session's drive data stale; no live channel
            // exists for it.
            onFinish: ({message}) => {
                markTraceAsFresh(getMessageTraceId(message))
                revalidateSessionMounts(sessionId)
                revalidateSessionRecords(sessionId)
            },
        },
    })

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
        chat,
        // Coalesce stream deltas to ~1 UI commit / 50ms so a fast token stream doesn't drive a
        // render per token; caps commit frequency independently of the per-commit memo win.
        experimental_throttle: 50,
    })

    const busy = isChatBusy(status)

    // `messages`/`busy` change every token; consumers that must stay referentially stable
    // (`handleRewind`, the hydration/SWR adoption guards) read them through refs instead.
    const messagesRef = useRef(messages)
    messagesRef.current = messages
    const busyRef = useRef(busy)
    busyRef.current = busy

    // Mid-stream drive signals: settled write-ish tool calls append file-activity entries (and
    // throttle-revalidate the drives) as the turn streams, not just at onFinish.
    useFileActivityDetector({sessionId, messages})

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
    })

    // A decision made in THIS mount marks the resume as live — a restored approval-requested tail
    // the user answers after a reload genuinely auto-resumes, so the queue's pre-resume hold applies.
    const markLiveGate = useCallback((interaction: LiveAgentInteraction) => {
        liveGateInteractionRef.current = interaction
    }, [])

    // Settle a parked client tool (#4920). The dispatcher calls this from a widget (e.g. the connect
    // widget) with the structured reference; `addToolOutput` matches the part by `toolCallId` on the
    // last turn and the resume predicate auto-resends. `tool` is only the typed-tools key — matching
    // is by id — so a cast onto the untyped UIMessage tool map is safe.
    const handleClientToolOutput = useCallback<ClientToolOutputHandler>(
        ({toolName, toolCallId, output, errorText}) => {
            liveGateInteractionRef.current = {kind: "client_tool", id: toolCallId}
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
        [addToolOutput],
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
        if (isChatBusy(status)) recordWatermarkRef.current = undefined
    }, [status])

    // Persist the conversation whenever its stream settles (skip mid-stream).
    useEffect(() => {
        if (status === "streaming") return
        persistMessages({id: sessionId, messages, recordCount: recordWatermarkRef.current})
    }, [messages, status, sessionId, persistMessages])

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
    const queryClient = useQueryClient()

    const handleStop = useCallback(() => {
        markStopped()
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

    // ── D9 teardown: release this mount's claim on the session's chat ──
    // A route change unmounts this conversation too, so "did the user close this session?" is read
    // from the open-tab set — the close/delete/archive/reset writers all commit before React runs
    // this cleanup, and a route change leaves the tab open.
    const scopeKey = useChatScopeKey()
    useEffect(() => {
        return () => {
            const stillOpen = store.get(openSessionIdsAtomFamily(scopeKey)).has(sessionId)
            releaseSessionChat(sessionId, {stillOpen})
        }
    }, [sessionId, scopeKey, store])

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
        resumeOrphaned,
        isSeen,
    }
}
