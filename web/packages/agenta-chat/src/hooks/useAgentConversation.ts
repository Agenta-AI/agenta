// Assembled from web/oss/src/components/AgentChatSlice/AgentConversation.tsx (2026-07-25) —
// the headless conversation host for one agent session. Copy-faithful on the shared engine
// behavior: transport wiring, resume predicate, hydration + revalidate-on-open, queue release,
// approvals, run-status publish, error stamping, persist-on-settle + expand-prune, stop/rewind.
// The desktop host keeps its own inline implementation until the re-plumb.
//
// Deliberately omitted (desktop-only): onboarding, template strips, and the IDE hand-off — the desktop host keeps its own implementation until the re-plumb.
// Deliberately omitted (desktop-only): the committed-revision switch and playground-controller self-commit handling — the desktop host keeps its own implementation until the re-plumb.
// Deliberately omitted (desktop-only): the run-in-playground seam (trigger drawer pending runs) — the desktop host keeps its own implementation until the re-plumb.
// Deliberately omitted (desktop-only): turn-capture and the Turn/Session Inspector wiring — the desktop host keeps its own implementation until the re-plumb.
// Deliberately omitted (desktop-only): scroll engineering (stick-to-bottom, anchors, jump pill) and list windowing — the desktop host keeps its own implementation until the re-plumb.
// Deliberately omitted (desktop-only): the kill-session-on-stop env flag and its query invalidations — the desktop host keeps its own implementation until the re-plumb.
// Deliberately omitted (desktop-only): drive surfaces and mid-stream file-activity detection — the desktop host keeps its own implementation until the re-plumb.
// Deliberately omitted (desktop-only): first-seen timestamp stamping (display metadata for the desktop rows) — the desktop host keeps its own implementation until the re-plumb.
// Deliberately omitted (desktop-only): session auto-titling and the first-run seed auto-send — the desktop host keeps its own implementation until the re-plumb.
// Deliberately omitted (desktop-only): the model-key composer gate — compose `useAgentModelKeyStatus` in the skin instead.
import {useCallback, useEffect, useMemo, useReducer, useRef, useState} from "react"

import {
    invalidateSessionListQueries,
    invalidateSessionLivenessQueries,
    recordInteractionAnswerAtom,
    revalidateSessionMountsAtom,
    revalidateSessionRecordsAtom,
    shouldAdoptServerTranscript,
} from "@agenta/entities/session"
import {markTraceAsFresh} from "@agenta/entities/trace"
import {buildRenderMap} from "@agenta/playground"
import {
    agentShouldResumeAfterApproval,
    approvalResolution,
    buildAgentRequest,
    isResumeSend,
    recordAnswerThenRelease,
    type LiveAgentInteraction,
} from "@agenta/playground/agent-chat"
import {generateId} from "@agenta/shared/utils"
import {useChat} from "@ai-sdk/react"
import type {FileUIPart, UIMessage} from "ai"
import {useSetAtom, useStore} from "jotai"

import {latestTurnId} from "../assets/agentTurn"
import {buildRequestWithinDeadline} from "../assets/boundedRequest"
import {filesToParts} from "../assets/files"
import {
    isSessionTranscript,
    loadSessionMessages,
    type SessionTranscript,
} from "../assets/loadSession"
import {messageText, sideEffectingToolsInRange} from "../assets/rewind"
import {startupLabelFromDataPart} from "../assets/startupPhases"
import {getMessageTraceId} from "../assets/trace"
import {isClientToolPart as defaultIsClientToolPart} from "../clientTools"
import {parseAgentRunError, type ParsedRunError} from "../model/error"
import {deriveSessionRunStatus, type SessionRunStatus} from "../model/sessionStatus"
import {
    buildTurnViewModels,
    createExecutedToolIdentityCache,
    type ClientToolPartPredicate,
    type TurnViewModel,
} from "../model/turnViewModel"
import {createUserStoppedState, reduceUserStoppedState} from "../model/userStop"
import {expandedKeysForMessages, pruneExpandedAtom} from "../state/expandState"
import {stampMessagesCreatedAtAtom} from "../state/messageStamps"
import {
    dropSessionChat,
    hasSessionChat,
    isChatBusy,
    type SessionChatHooks,
} from "../state/sessionChats"
import {
    clearSessionFresh,
    clearSessionTurnId,
    composerDraftBySession,
    isSessionFresh,
    setSessionTurnId,
} from "../state/sessionEphemera"
import {
    persistSessionMessagesAtom,
    sessionMessagesAtom,
    sessionRecordCountsReadAtom,
    setSessionStatusAtom,
} from "../state/sessionMessages"
import {clearTurnClockAtom, startTurnClockAtom} from "../state/turnClock"

import {useAgentChatQueue, type QueuedMessage} from "./useAgentChatQueue"
import {useApprovalDock, type ApprovalDock} from "./useApprovalDock"
import {useSessionChat} from "./useSessionChat"
import {useSessionLivePreview} from "./useSessionLivePreview"

/** A stream error/abort is already surfaced via `useChat`'s `onError` + the stamped in-chat
 * error; swallow the floating `sendMessage`/`regenerate` rejection so it doesn't bubble to a
 * dev runtime-error overlay (F-033). */
const ignoreStreamRejection = () => {}

export interface SendInput {
    text: string
    files?: File[]
    /** Prebuilt file parts (server-uploaded attachment references) — appended after `files`. */
    parts?: FileUIPart[]
}

/** The pure scan result of a rewind request; the skin renders any confirm UI and then calls
 * `confirm()` — the hook never opens dialogs. */
export interface RewindPlan {
    /** Side-effecting tools that already ran at/after this message — a rewind cannot undo them;
     * when non-empty the skin should confirm before calling `confirm()`. */
    sideEffects: string[]
    /** For a user-message rewind: the message text to put back into the composer. */
    restoreText?: string
    /** Execute the rewind: truncate before a user message, regenerate an assistant one. */
    confirm: () => void
}

/** Settle a parked client tool (#4920). The hook maps this onto `addToolOutput` (success or
 * error) and marks the resume live so the auto-resend fires. */
export interface ToolOutputSettleInput {
    toolName: string
    toolCallId: string
    output?: Record<string, unknown>
    errorText?: string
}

export interface UseAgentConversationArgs {
    entityId: string
    sessionId: string
    /** Host-derived capability + remote-owner gate for the display-only live reader. */
    sharedReaderEnabled?: boolean
    /** Timestamp of the liveness snapshot behind `sharedReaderEnabled`. */
    sharedReaderLivenessUpdatedAt?: number
    /** Override the client-tool predicate. Defaults to the package registry's, so a host does not
     * have to opt IN to elicitation and connect widgets — /m shipped without one for months and
     * silently folded every client tool into the plain "used N tools" group, leaving the run
     * parked with nothing on screen to answer. */
    isClientToolPart?: ClientToolPartPredicate
}

export interface AgentConversation {
    messages: UIMessage[]
    /** Raw stream status from `useChat`. */
    status: "ready" | "submitted" | "streaming" | "error"
    /** Session-level run state (error > awaiting > running > idle) — also published to
     * `sessionStatusAtomFamily` for session-list status dots. */
    runStatus: SessionRunStatus
    /** Parsed reason of the current stream failure, when there is one. */
    error?: ParsedRunError
    /** Pre-grouped per-turn view models (render items, status, empty-collapse, active turn). */
    turns: TurnViewModel[]
    /** Send a user message (routes through the queue: sends now, or holds while busy/paused). */
    send: (input: SendInput) => Promise<void>
    /** Abort the in-flight stream and tag the last assistant turn as user-stopped. */
    stop: () => void
    /** Re-run an assistant turn by message id (also the "Resend" action after a stop). */
    regenerate: (id: string) => void
    /** Scan a rewind target; null while busy or for an unknown message. */
    rewind: (message: UIMessage) => RewindPlan | null
    /** Server hydration for an uncached session is in flight — show a transcript skeleton. */
    isHydrating: boolean
    /** No messages at all (skins combine with `isHydrating`/`historyUnavailable` for the hero). */
    isEmpty: boolean
    /** A known session hydrated EMPTY from the server — its durable history was pruned or never
     * persisted; show a notice rather than the new-chat hero. */
    historyUnavailable: boolean
    /** The last assistant turn was user-stopped (cleared on the next send/regenerate). */
    stopped: boolean
    /** Messages held while a turn is in flight, in FIFO order. */
    queued: QueuedMessage[]
    /** The run is parked on the USER — an approval gate or an unanswered client tool (elicitation,
     * connect). Typed messages queue rather than send while this holds. */
    hitlPending: boolean
    removeQueued: (id: string) => void
    /** Id of the held message the composer is editing, or null. */
    editingId: string | null
    /** Borrow the composer for `id`, stashing the draft it currently holds. */
    beginEdit: (id: string, draft?: string) => void
    /** Drop the edit and hand the stashed draft back. */
    cancelEdit: () => string
    /** Rewrite the edited message with the composer's content (or queue it anew if it drained).
     *  Returns the draft the session displaced, for the host to put back. */
    commitEdit: (item: {text: string; fileParts?: FileUIPart[]}) => string
    /** Headless approval-dock state wired to the live-gate-aware response path. */
    approvals: ApprovalDock
    /** Settle a parked client tool part (widgets call this; the resume predicate auto-resends). */
    sendToolOutput: (args: ToolOutputSettleInput) => void
    /** Re-fetch the durable records and adopt the server transcript under the same guards as
     * revalidate-on-open (never mid-stream, only when strictly ahead). Wire push signals — a
     * session watch relay, a foreground event — to this. */
    revalidate: () => void
}

/**
 * One agent conversation for a single session. A `useChat` whose transport is fed by the
 * playground request builder (`buildAgentRequest`) — the entity supplies the config/auth/
 * references, the session id travels to the backend as `session_id`. Messages persist to
 * localStorage (seeded on mount, written when the stream settles) so the session survives a
 * reload / revision swap. Headless: every surface (bubbles, composer, dock, notices) is the
 * skin's job; this hook owns the engine behavior only.
 */
export const useAgentConversation = ({
    entityId,
    sessionId,
    sharedReaderEnabled = false,
    sharedReaderLivenessUpdatedAt = 0,
    isClientToolPart,
}: UseAgentConversationArgs): AgentConversation => {
    const store = useStore()
    const persistMessages = useSetAtom(persistSessionMessagesAtom)
    const setSessionStatus = useSetAtom(setSessionStatusAtom)
    const revalidateSessionMounts = useSetAtom(revalidateSessionMountsAtom)
    const revalidateSessionRecords = useSetAtom(revalidateSessionRecordsAtom)
    const pruneExpanded = useSetAtom(pruneExpandedAtom)
    const stampMessagesCreatedAt = useSetAtom(stampMessagesCreatedAtAtom)
    const setTurnStartupLabel = useSetAtom(startTurnClockAtom)
    const clearTurnClock = useSetAtom(clearTurnClockAtom)

    // Seed once from the persisted store (read imperatively so our own writes don't feed back).
    const [initialMessages] = useState(() => store.get(sessionMessagesAtom)[sessionId] ?? [])
    // Only the last assistant turn can carry the current stopped state.
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
    // Restored (not live-streamed) message ids — the orphaned-resume detection reads this, and a
    // skin can use it to skip entrance animations for restored rows.
    const restoredIdsRef = useRef<Set<string>>(new Set(initialMessages.map((m) => m.id)))
    // How many durable records the transcript we're RENDERING was built from — the exact test for
    // "has the server moved on?" (#5530). A message count cannot see a turn grow IN PLACE:
    // `transcriptToMessages` folds a paused turn into its resume and only closes a message on
    // `done`, so a mid-approval snapshot and the completed turn have the SAME message count, and a
    // count-only guard rejects the finished server copy forever. Seeded from the watermark the
    // cached transcript was persisted with; cleared when a live turn supersedes it (we can't know
    // what the server logged for that one), so the next open re-syncs from the log.
    const recordWatermarkRef = useRef<number | undefined>(
        store.get(sessionRecordCountsReadAtom)[sessionId],
    )
    // Durable sequence coverage is connection-local and must never be stored as a row count.
    const sequenceWatermarkRef = useRef<number | undefined>(undefined)

    // The registry owns the `Chat` and its transport for the life of the session, so the request
    // builder must read the CURRENT entity — capturing `entityId` by value would send every turn
    // with the revision displayed when the session first mounted.
    const entityIdRef = useRef(entityId)
    entityIdRef.current = entityId

    // Whether this mount is still on screen. The chat outlives it, so its callbacks need to tell
    // "still mine to report" from "running on in the background".
    const mountedRef = useRef(false)

    // Only a gate settled in this mount may trigger an automatic resume; hydrated answers stay inert.
    // `null` means "no live gate" — voided by a stop, or spent once a resume really went out;
    // `undefined` means "no live marker", which falls back to the predicate's tail heuristics.
    const liveGateInteractionRef = useRef<LiveAgentInteraction | null | undefined>(null)
    const recordInteractionAnswer = useSetAtom(recordInteractionAnswerAtom)

    // Tracks `busy` for callbacks that outlive a render (the preserve verdict at unmount).
    const busyRef = useRef(false)
    const messagesRef = useRef(initialMessages)

    const hooks: SessionChatHooks = {
        prepareRequest: async ({messages, id}) => {
            clearSessionTurnId(sessionId)
            // Bounded, not instant. A null build means the workflow entity has not loaded its
            // invocation URL YET — the first send to a freshly created agent races that fetch, and
            // failing on the first null made a new user's first message fail (#6042 on the desktop;
            // the same race reached /m through this hook).
            const req = await buildRequestWithinDeadline(() =>
                buildAgentRequest(entityIdRef.current, messages, {
                    sessionId: id ?? sessionId,
                }),
            )
            return {api: req.invocationUrl, headers: req.headers, body: req.requestBody}
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
        // The turn's trace may not be ingested yet when a row asks for its summary — marking it
        // fresh lets the trace queries retry through the ingestion lag. A finished turn may also
        // have written files: mark the session's drive data stale so every mount surface refetches.
        // #6047 startup states: the runner narrates what it is doing while the environment boots,
        // so a 15s cold start reads as progress instead of a stalled session.
        onData: (part) => {
            const label = startupLabelFromDataPart(part)
            if (label) setTurnStartupLabel(sessionId, label)
        },
        onFinish: ({message, messages: finishedMessages, finishReason}) => {
            dispatchStopped({
                type: "stream-terminal",
                messages: finishedMessages,
                finishReason,
            })
            markTraceAsFresh(getMessageTraceId(message))
            revalidateSessionMounts(sessionId)
            revalidateSessionRecords(sessionId)
            // The first turn is what creates the durable session row; every later one changes its
            // title, preview and activity. Nothing else tells the session lists, so a brand-new
            // session surfaced only on their next remount past the stale time.
            invalidateSessionListQueries()
            // Nothing else invalidates liveness at turn end either, so the project-wide poll's
            // cached `is_running: true` outlived the answer by up to 15s (#5844). Safe to refetch
            // immediately — the runner awaits its `is_running: false` heartbeat BEFORE closing
            // this stream (services/runner/src/server.ts `aliveWatchdog.release()`).
            invalidateSessionLivenessQueries()
            // Mobile keeps a chat only while its run streams (no tab model bounds it), so a run
            // that settles with nobody mounted retires its own dot and releases the instance. A
            // LIVE mount publishes its own status from `runStatus`, so writing here would flicker.
            if (!mountedRef.current) {
                setSessionStatus({id: sessionId, status: "idle"})
                dropSessionChat(sessionId)
            }
        },
        onError: () => {
            // Clear the marker but do NOT void the resume. A gateway approval is answered while the
            // stream is still open, so the SDK skips its own dispatch and only re-evaluates when the
            // stream ends — often by erroring, right here. `null` made that last evaluation return
            // false and stranded the answer; `undefined` lets the tail heuristics decide.
            // Adoption is unaffected: the hydration guard reads this ref as a boolean.
            // The registry logs the error for the dev overlay (F-033) before calling this.
            liveGateInteractionRef.current = undefined
        },
    }

    // The registry owns the `Chat`, so re-entering the route re-binds to the SAME instance
    // mid-turn instead of aborting the run (#5724). Mobile has no tab model — the active session
    // is the URL — so a chat is preserved only while its run is actually streaming; an idle one
    // is released with the mount, and `onFinish` releases a run that settles unmounted.
    const chat = useSessionChat({
        sessionId,
        initialMessages,
        hooks,
        shouldPreserve: () => busyRef.current,
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
    // Require liveness newer than the local settle before classifying a run as remote.
    const previousBusyForReaderRef = useRef(busy)
    const localReaderSettleAtRef = useRef(0)
    if (previousBusyForReaderRef.current && !busy) localReaderSettleAtRef.current = Date.now()
    previousBusyForReaderRef.current = busy
    const remoteRunIsFresh = sharedReaderLivenessUpdatedAt > localReaderSettleAtRef.current
    // `messages`/`busy` change every commit; consumers that must stay referentially stable
    // (`rewind`, the hydration/revalidation adoption guards) read them through refs instead.
    messagesRef.current = messages
    busyRef.current = busy

    useEffect(() => {
        dispatchStopped({type: "transcript", messages})
    }, [messages])

    // Keep only the newest turn id observed from this session's live stream.
    useEffect(() => {
        const turnId = latestTurnId(messages)
        if (turnId) setSessionTurnId(sessionId, turnId)
    }, [messages, sessionId])

    // Hybrid history: localStorage holds the cached conversation; the durable content lives in
    // the backend record log. Cache-first — when this session opens with no locally-cached
    // messages (never ran here, or after a storage clear), hydrate once from the server and seed.
    // A to-be-hydrated session (empty local cache, not brand-new) reports `isHydrating` so the
    // skin shows a transcript skeleton instead of the empty-state hero.
    // Did a PREVIOUS mount leave a live chat behind? Read once, during the first render — this
    // mount publishes its own chat at commit, so reading it later would always say yes. A preserved
    // run is still streaming into the chat we just re-bound to, and a transcript is only persisted
    // on SETTLE, so `initialMessages` is empty mid-stream and hydration would otherwise put the
    // loading screen over the very run we kept alive (#5724).
    const [resumedLiveChat] = useState(() => hasSessionChat(sessionId))
    const [isHydrating, setIsHydrating] = useState(
        () => initialMessages.length === 0 && !isSessionFresh(sessionId) && !resumedLiveChat,
    )
    // Set when server hydration for a KNOWN (non-fresh, uncached) session returns no records —
    // its durable history was pruned by retention or never persisted.
    const [historyUnavailable, setHistoryUnavailable] = useState(false)

    /**
     * THE adoption guard — one implementation for every path that can hand us a server transcript
     * (hydration, its background revalidation, revalidate-on-open, and the pushed `revalidate`).
     * They used to carry near-identical copies that had already drifted (only one cleared the
     * history-unavailable notice) and all of them compared MESSAGE COUNTS only, so an in-place turn
     * completion — an approval resolving into the same assistant message — was silently skipped.
     * The rule itself is the shared `shouldAdoptServerTranscript`: the record watermark is the
     * trigger, the message count only a floor. Returns whether it adopted.
     */
    const adoptServerTranscript = useCallback(
        (transcript: unknown): boolean => {
            if (!isSessionTranscript(transcript)) return false
            const {messages: serverMsgs, recordCount, sequenceCursor} = transcript
            const adopt = shouldAdoptServerTranscript({
                serverRecordCount: sequenceCursor ?? recordCount,
                serverMessageCount: serverMsgs.length,
                localMessageCount: messagesRef.current.length,
                watermark:
                    sequenceCursor === undefined
                        ? recordWatermarkRef.current
                        : sequenceWatermarkRef.current,
                busy: busyRef.current,
            })
            if (!adopt) return false
            serverMsgs.forEach((m) => restoredIdsRef.current.add(m.id))
            // Adopting a non-empty server transcript settles the question the notice asks, so it
            // clears here for every path (the revalidate copy did this, the hydration one didn't).
            setHistoryUnavailable(false)
            // Written synchronously, ahead of any React commit: `messagesRef` lags a commit behind,
            // so two deliveries landing back-to-back (the disk-restored result and the background
            // refetch) can both see the pre-adoption transcript. It is this watermark, not the
            // on-screen length, that keeps the guard order-independent.
            recordWatermarkRef.current = recordCount
            if (sequenceCursor !== undefined) sequenceWatermarkRef.current = sequenceCursor
            setMessages(serverMsgs)
            persistMessages({id: sessionId, messages: serverMsgs, recordCount})
            return true
        },
        [persistMessages, sessionId, setMessages],
    )

    useEffect(() => {
        // A session created brand-new in this browser and not yet run has no backend records —
        // skip the guaranteed-empty query (cleared on first send; after a reload it re-hydrates).
        if (initialMessages.length > 0 || isSessionFresh(sessionId) || resumedLiveChat) {
            setIsHydrating(false)
            return
        }
        // No persistent "already-hydrated" ref: the `cancelled` flag is the whole guard, so React
        // StrictMode's mount→unmount→mount cycle re-runs the fetch (the first run is cancelled)
        // instead of latching a ref that leaves the transcript blank.
        let cancelled = false
        // The background refetch can land BEFORE the promise handler below runs (both are
        // microtasks racing) and `messagesRef` only catches up on the next commit — so record here,
        // not from what's on screen, that real history was already adopted.
        let adopted = false
        // Post-restore revalidation: the first result may be the disk-restored log (paints
        // instantly); when the guaranteed background refetch lands, adopt it under the same
        // guard as every other path.
        loadSessionMessages(sessionId, (fresh) => {
            if (cancelled) return
            if (adoptServerTranscript(fresh)) adopted = true
        })
            .then((transcript) => {
                if (cancelled) return
                if (!transcript || transcript.messages.length === 0) {
                    // Known session, but the server has no records for it → history was pruned or
                    // never persisted. Flag it so the skin shows the "unavailable" notice — unless
                    // a refetch already landed real history, which this stale first result must
                    // not blank out.
                    if (!adopted) setHistoryUnavailable(true)
                    return
                }
                adoptServerTranscript(transcript)
            })
            .finally(() => {
                if (!cancelled) setIsHydrating(false)
            })
        return () => {
            cancelled = true
        }
        // Seed once per mounted session; `sessionId` is stable for this instance.
    }, [sessionId])

    // Revalidate-on-open: a cached session paints instantly from localStorage; in the background
    // we refetch the durable records ONCE and adopt the server transcript when the RECORD LOG has
    // grown past what the cached transcript was built from. We never clobber a transcript that's
    // live (`busyRef`), and never trade a longer local tail for a shorter server one — so a local
    // optimistic/unsent tail is safe.
    useEffect(() => {
        if (initialMessages.length === 0 || isSessionFresh(sessionId)) return
        // As above: no persistent ref, so StrictMode's double-mount re-runs the revalidation.
        let cancelled = false
        const adopt = (transcript: SessionTranscript | null) => {
            if (cancelled) return
            adoptServerTranscript(transcript)
        }
        // The first result may itself be the disk-restored records log; the callback re-applies
        // the same guarded adoption when the guaranteed background revalidation lands.
        loadSessionMessages(sessionId, adopt).then(adopt)
        return () => {
            cancelled = true
        }
        // Once per mounted session; `sessionId` is stable for this instance.
    }, [sessionId])

    // Send one released queued message. Stable (only depends on `sendMessage`) so the queue's
    // release effect doesn't churn on every token.
    const sendQueued = useCallback(
        (item: QueuedMessage) => {
            // A real send means this session has run — drop the never-run marker so a later
            // cache-cleared reopen hydrates from the server.
            clearSessionFresh(sessionId)
            clearSessionTurnId(sessionId)
            // Any actual send supersedes a prior user-stop.
            setStopped(false)
            sendMessage(
                item.fileParts && item.fileParts.length
                    ? item.text
                        ? {text: item.text, files: item.fileParts}
                        : {files: item.fileParts}
                    : {text: item.text},
            ).catch(ignoreStreamRejection)
        },
        [sendMessage, sessionId],
    )

    // Orphan detection for the queue's pre-resume hold: the tail is a RESTORED message (this
    // mount never streamed it) shaped like "auto-resume imminent", and no gate was settled live
    // in this mount. The SDK only evaluates `sendAutomaticallyWhen` on live events — never on
    // mount — so this resume can't fire and must not hold the queue (AGE-3937).
    const lastMessage = messages[messages.length - 1]
    const resumeOrphaned =
        !liveGateInteractionRef.current &&
        !!lastMessage &&
        restoredIdsRef.current.has(lastMessage.id) &&
        agentShouldResumeAfterApproval({messages})

    // Queue messages typed while a turn is streaming or paused on a HITL approval; released
    // one-by-one once the turn truly settles (never mid-approval).
    const {
        queued,
        submit,
        removeQueued,
        hitlPending,
        editingId,
        beginEdit,
        cancelEdit,
        commitEdit,
    } = useAgentChatQueue({
        status,
        messages,
        stopped,
        resumeOrphaned,
        sendQueued,
        sessionId,
    })

    // Approval responses flow through here (not bare `addToolApprovalResponse`) so a decision
    // made in THIS mount marks the resume as live — a restored approval-requested tail the user
    // answers after a reload genuinely auto-resumes, so the queue's pre-resume hold applies.
    const handleApprovalResponse = useCallback(
        (args: {id: string; approved: boolean}) => {
            liveGateInteractionRef.current = {kind: "approval", id: args.id}
            // Ordered, not raced: the DECISION lands on the interaction row first, and only then
            // does the part flip that lets the SDK dispatch its resume. Flipped first, that
            // resume's stale sweep cancelled the row being answered. No resume from here either —
            // the park stream finishes cleanly, so the SDK is the only sender.
            void recordAnswerThenRelease({
                record: () =>
                    recordInteractionAnswer({
                        sessionId,
                        toolCallId: args.id,
                        resolution: approvalResolution(args.id, args.approved),
                    }),
                release: () => addToolApprovalResponse(args),
            })
        },
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

    // `render.kind` rides as a sibling `data-render` part (AI SDK tool chunks are strict), so the
    // widget dispatch needs a toolCallId → hint map. Built across the WHOLE conversation rather
    // than per message: toolCallIds are unique, and the predicate below sees parts without knowing
    // which message they came from.
    const renderMap = useMemo(
        () => buildRenderMap(messages.flatMap((m) => m.parts) as {type?: string; data?: unknown}[]),
        [messages],
    )

    const approvals = useApprovalDock({messages, respond: handleApprovalResponse})

    // Settle a parked client tool (#4920). A widget calls this with the structured reference;
    // `addToolOutput` matches the part by `toolCallId` on the last turn and the resume predicate
    // auto-resends. `tool` is only the typed-tools key — matching is by id — so a cast onto the
    // untyped UIMessage tool map is safe.
    const sendToolOutput = useCallback(
        ({toolName, toolCallId, output, errorText}: ToolOutputSettleInput) => {
            liveGateInteractionRef.current = {kind: "client_tool", id: toolCallId}
            // Ordered like the approval half: the resume starts a turn whose sweep cancels every
            // `pending` row, so the answer has to be durable first. Capped inside the helper.
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

    // Publish this session's run state (single source of truth for session-list status dots).
    // Precedence error > awaiting approval > running > idle.
    const runStatus = deriveSessionRunStatus({error: !!error, hitlPending, busy})
    useEffect(() => {
        setSessionStatus({id: sessionId, status: runStatus})
    }, [runStatus, sessionId, setSessionStatus])
    // On unmount, retire the dot ONLY if the run went with us. A chat preserved past this mount is
    // still this browser's run to report, so it keeps its status until it settles — `onFinish`
    // retires it then. The release above already ran, so the registry is authoritative here.
    useEffect(
        () => () => {
            if (!hasSessionChat(sessionId)) setSessionStatus({id: sessionId, status: "idle"})
        },
        [sessionId, setSessionStatus],
    )

    // Surface a stream failure inline: stamp the parsed error onto the failing assistant turn so
    // it renders as an error bubble with the real reason (and persists with the session via the
    // effect below), instead of a transient banner + a generic "no response".
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
        if (status === "submitted" || status === "streaming") {
            recordWatermarkRef.current = undefined
            sequenceWatermarkRef.current = undefined
        }
    }, [status])

    // Persist the conversation whenever its stream settles (skip mid-stream), under whatever
    // watermark the rendered transcript still stands on (undefined once a live turn extended it).
    useEffect(() => {
        if (status === "streaming") return
        persistMessages({id: sessionId, messages, recordCount: recordWatermarkRef.current})
    }, [messages, status, sessionId, persistMessages])

    // One startup label per in-flight turn. `submitted` opens a NEW turn, so a label the previous
    // one left behind must go; `streaming` is the same turn continuing, so its clock is left alone;
    // every other status is terminal (answered, errored, stopped) and must not strand a label.
    useEffect(() => {
        if (status === "streaming") return
        clearTurnClock(sessionId)
    }, [status, sessionId, clearTurnClock])

    // Stamp a first-seen timestamp on any newly-appeared LIVE message (user + assistant) — the
    // fallback the timestamp uses until the turn's trace arrives. Restored rows are excluded: their
    // first-seen is the reload moment, not the turn's time, and stamping them makes day-old turns
    // read "just now" forever.
    useEffect(() => {
        stampMessagesCreatedAt(
            messages.filter((m) => !restoredIdsRef.current.has(m.id)).map((m) => m.id),
        )
    }, [messages, stampMessagesCreatedAt])

    // Bound the in-message expand-state store: on settle, drop entries whose owning message is
    // gone (rewound / evicted / closed). Live = every persisted session's messages ∪ this active
    // one. `store.get` reads without subscribing, so this adds no re-renders mid-stream.
    useEffect(() => {
        if (status === "streaming") return
        const persisted = store.get(sessionMessagesAtom)
        const live = new Set<string>()
        for (const sid in persisted)
            for (const key of expandedKeysForMessages(persisted[sid])) live.add(key)
        for (const key of expandedKeysForMessages(messages)) live.add(key)
        pruneExpanded(live)
    }, [messages, status, store, pruneExpanded])

    // Push-signal revalidation: same guarded adoption as revalidate-on-open, callable at any
    // time (a watch relay tick, app foregrounding). Guards make it idempotent and stream-safe.
    const revalidate = useCallback(
        async (transcript?: SessionTranscript): Promise<boolean> => {
            const adoptOrConfirm = (candidate: unknown): boolean => {
                if (!isSessionTranscript(candidate)) return false
                const candidateWatermark = candidate.sequenceCursor ?? candidate.recordCount
                const currentWatermark =
                    candidate.sequenceCursor === undefined
                        ? recordWatermarkRef.current
                        : sequenceWatermarkRef.current
                return (
                    adoptServerTranscript(candidate) ||
                    (currentWatermark ?? 0) >= candidateWatermark
                )
            }
            if (isSessionTranscript(transcript)) {
                return adoptOrConfirm(transcript)
            }
            revalidateSessionRecords(sessionId)
            let adopted = false
            let refreshed: SessionTranscript | null
            try {
                refreshed = await loadSessionMessages(sessionId, (fresh) => {
                    if (adoptOrConfirm(fresh)) adopted = true
                })
            } catch {
                return false
            }
            return adoptOrConfirm(refreshed) || adopted
        },
        [adoptServerTranscript, revalidateSessionRecords, sessionId],
    )

    const {messages: previewMessages} = useSessionLivePreview({
        sessionId,
        sharedReaderAdvertised: sharedReaderEnabled,
        runningElsewhere: !busy && remoteRunIsFresh,
        onDisconnect: revalidate,
    })
    const displayMessages = useMemo(
        () => (previewMessages.length ? [...messages, ...previewMessages] : messages),
        [messages, previewMessages],
    )

    // ── DT3 cancelled state: wrap stop() to mark the in-flight assistant turn ──
    const handleStop = useCallback(() => {
        const last = messagesRef.current[messagesRef.current.length - 1]
        if (last && last.role === "assistant") setStopped(true)
        // A stop voids the pending gate (same rule the queue applies), so the marker must go too —
        // otherwise it outlives the abandoned resume and blocks this mount's records adoption.
        liveGateInteractionRef.current = null
        stop()
    }, [stop])

    // ── D9 teardown: `useSessionChat` releases this mount's claim on the session's chat ──
    // No `stop()` here: a streaming run is preserved past the unmount on purpose (#5724), and
    // aborting would kill the run the registry is keeping alive. `releaseSessionChat` stops the
    // stream for the sessions that are NOT preserved.
    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
        }
    }, [sessionId])

    const send = useCallback(
        async ({text, files, parts}: SendInput) => {
            const trimmed = text.trim()
            const fileObjs = files ?? []
            const refParts = parts ?? []
            if (!trimmed && fileObjs.length === 0 && refParts.length === 0) return
            // Send what encoded. A file that cannot be read no longer takes the text and the
            // other attachments down with it (`filesToParts` settles each file separately).
            const encoded = fileObjs.length ? await filesToParts(fileObjs) : undefined
            const merged = [...(encoded?.parts ?? []), ...refParts]
            const fileParts = merged.length ? merged : undefined
            if (encoded?.rejections.length) {
                console.warn("[useAgentConversation] attachments could not be read:", {
                    files: encoded.rejections.map((r) => r.name),
                })
            }
            clearSessionTurnId(sessionId)
            setStopped(false)
            // One path: `submit` sends now or queues behind held messages via the release gate.
            submit({text: trimmed, fileParts})
            // The message left the composer — drop its persisted draft (per-session store).
            composerDraftBySession.delete(sessionId)
        },
        [submit, sessionId],
    )

    const regenerateTurn = useCallback(
        (id: string) => {
            clearSessionTurnId(sessionId)
            setStopped(false)
            regenerate({messageId: id}).catch(ignoreStreamRejection)
        },
        [regenerate, sessionId],
    )

    // Rewind scan: pure side-effect detection + a deferred `confirm()`. The skin owns the
    // warning dialog (when `sideEffects` is non-empty) and the composer refill (`restoreText`).
    const rewind = useCallback(
        (message: UIMessage): RewindPlan | null => {
            const msgs = messagesRef.current
            if (busyRef.current) return null
            const idx = msgs.findIndex((m) => m.id === message.id)
            if (idx < 0) return null
            const isUser = message.role === "user"
            const sideEffects = sideEffectingToolsInRange(msgs.slice(idx))
            const confirm = () => {
                if (isUser) {
                    // The skin calls this after its warning dialog, so `msgs`/`idx` are a
                    // snapshot from scan time. A revalidation adopted in that window would be
                    // thrown away by writing the stale array, so re-resolve against the live
                    // transcript and bail if the message is no longer in it.
                    const current = messagesRef.current
                    const at = current.findIndex((m) => m.id === message.id)
                    if (at < 0) return
                    setMessages(current.slice(0, at))
                } else {
                    clearSessionTurnId(sessionId)
                    regenerate({messageId: message.id}).catch(ignoreStreamRejection)
                }
            }
            return {sideEffects, restoreText: isUser ? messageText(message) : undefined, confirm}
        },
        [regenerate, sessionId, setMessages],
    )

    // Per-mount executed-identity cache — the desktop's per-message toolSignature memo,
    // recreated hook-side so the identity JSON.stringify doesn't re-run per streamed token.
    const [executedFor] = useState(() => createExecutedToolIdentityCache())
    const turns = useMemo(
        () =>
            buildTurnViewModels(displayMessages, {
                busy: busy || previewMessages.length > 0,
                executedFor,
                isClientToolPart: (part, ctx) =>
                    (isClientToolPart ?? defaultIsClientToolPart)(part, ctx, renderMap),
            }),
        [displayMessages, busy, executedFor, isClientToolPart, previewMessages.length, renderMap],
    )

    const parsedError = useMemo(() => (error ? parseAgentRunError(error) : undefined), [error])

    return {
        messages: displayMessages,
        status,
        runStatus,
        error: parsedError,
        turns,
        send,
        stop: handleStop,
        regenerate: regenerateTurn,
        rewind,
        isHydrating,
        isEmpty: displayMessages.length === 0,
        historyUnavailable,
        stopped,
        queued,
        hitlPending,
        removeQueued,
        editingId,
        beginEdit,
        cancelEdit,
        commitEdit,
        approvals,
        sendToolOutput,
        revalidate,
    }
}
