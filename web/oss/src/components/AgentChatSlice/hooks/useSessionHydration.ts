import {type MutableRefObject, useCallback, useEffect, useRef, useState} from "react"

import {isSessionTranscript, loadSessionMessages, type SessionTranscript} from "@agenta/chat/assets"
import {durableTranscriptMessages} from "@agenta/chat/model"
import {hasSessionChat, isSessionFresh} from "@agenta/chat/state"
import {
    fetchSessionRecordsAtom,
    hasWaitingInteraction,
    revalidateSessionRecordsAtom,
    type SessionInteractionRowStates,
    shouldAdoptServerTranscript,
} from "@agenta/entities/session"
import {isHitlPending} from "@agenta/playground"
import {generateId} from "@agenta/shared/utils"
import {type UIMessage} from "ai"
import {getDefaultStore, useAtomValue, useSetAtom} from "jotai"

import {projectIdAtom} from "@/oss/state/project"

import {shouldRefreshOnReady} from "../assets/readyRefresh"
import {sessionLivenessAtomFamily, sessionRunningElsewhereAtomFamily} from "../state/liveness"
import {useChatScopeKey} from "../state/scope"
import {activeSessionIdAtomFamily} from "../state/sessions"

import {type ScrollIntent} from "./useScrollIntent"
import {useSessionRecordsWatch} from "./useSessionRecordsWatch"

/** Catch-up cadence while a session runs elsewhere — matches the records query's own staleTime and
 * the liveness poll, so a tick refetches instead of resolving from a still-fresh cache. */
const REMOTE_RUN_POLL_MS = 15_000

/** Ceiling once the log goes quiet. `is_running` is Redis-TTL'd at an hour (the runner clears it at
 * turn end; the TTL is only the crash backstop), so a runner that dies mid-turn leaves the flag set
 * for a long time — without a backoff that is a full-log refetch every 15s for an hour. Real growth
 * resets to the fast cadence, so a long turn that is simply quiet (a slow tool call emits no
 * records until it returns) is still followed. */
const REMOTE_RUN_POLL_MAX_MS = 60_000

/** Retry budget for the stranded-first-send record check when the fetch itself fails
 * (`records: null`). Bounded so a down endpoint gets a short burst, not a hammer; when the budget
 * runs out the check re-arms and waits for the next dependency change instead. */
const STRANDED_CHECK_MAX_ATTEMPTS = 3
const STRANDED_CHECK_RETRY_MS = 2_000

/**
 * Whether the records-changed relay's catch-up refetch must skip this tick.
 *
 * `busy` is the existing guard (a live local stream outranks the log). `pendingResume` is new:
 * a client-tool settle (connect Not-now/Connect, an elicitation answer) writes
 * `liveGateInteractionRef` synchronously and clears it only once `sendAutomaticallyWhen`
 * actually dispatches the resume — `busy` doesn't flip true until THAT dispatch lands, so
 * there is a real gap where the settle is local-only and not yet durable. A relay tick in that
 * gap previously adopted a server transcript that predates the settle, silently discarding it —
 * the parked interaction then never resumes (bug: "Not now" firing zero network requests).
 */
export const shouldSkipRecordsRefresh = ({
    busy,
    pendingResume,
}: {
    busy: boolean
    pendingResume: boolean
}): boolean => busy || pendingResume

/** A transcript whose tail is a user turn nothing ever answered — the shape a send that died
 * client-side (aborted mid-prepare, a lost seed handoff) leaves behind (#6042). */
export const hasStrandedTail = (messages: UIMessage[]): boolean =>
    messages.length > 0 && messages[messages.length - 1]?.role === "user"

/**
 * Protect local interaction state only when the pending server row already has an actionable card
 * on screen. A pending row by itself is not enough: the browser may have cached the transcript
 * before the interaction_request record arrived. Treating that stale copy as user-owned state
 * prevents hydration from ever delivering the missing approval or form.
 */
export const shouldProtectRenderedInteraction = (
    messages: UIMessage[],
    interactionRows: SessionInteractionRowStates | undefined,
): boolean => hasWaitingInteraction(interactionRows) && isHitlPending(messages)

/** Same carrier shape `useAgentChatSession`'s error effect uses, so the stamp renders through the
 * existing red error bubble. */
const strandedRunErrorCarrier = (): UIMessage =>
    ({
        id: `run-error-${generateId()}`,
        role: "assistant",
        parts: [],
        metadata: {
            runError: {
                message:
                    "This message never reached the agent — the run was not started. Send it again.",
            },
        },
    }) as unknown as UIMessage

/**
 * Hybrid history for one session tab. localStorage holds only the session INDEX; the durable
 * conversation CONTENT lives in the backend record log — so a tab either paints from cache and
 * revalidates (SWR), or hydrates from the server once (cache miss). Both paths adopt the server
 * transcript through the SAME guard: never mid-stream, and only when the record log has grown past
 * what's on screen.
 */
export const useSessionHydration = ({
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
    clearRunError,
    intent,
    pendingResumeRef,
}: {
    sessionId: string
    initialMessages: UIMessage[]
    messagesRef: MutableRefObject<UIMessage[]>
    busyRef: MutableRefObject<boolean>
    seenIdsRef: MutableRefObject<Set<string>>
    restoredIdsRef: MutableRefObject<Set<string>>
    /** Records the rendered transcript was built from; `undefined` once a live turn supersedes it. */
    recordWatermarkRef: MutableRefObject<number | undefined>
    /** Durable sequence coverage for sequenced reconnect snapshots; never a row count. */
    sequenceWatermarkRef: MutableRefObject<number | undefined>
    /** THIS browser is streaming the turn — reactive, so the catch-up poll can start/stop on it. */
    busy: boolean
    setMessages: (messages: UIMessage[]) => void
    persistMessages: (args: {id: string; messages: UIMessage[]; recordCount?: number}) => void
    /** Drop the stream error `useChat` is holding. Adopting the log supersedes it. */
    clearRunError: () => void
    intent: ScrollIntent
    /**
     * Non-null while a client-tool settle (connect Not-now/Connect, an elicitation answer) has
     * fired locally and is waiting for `sendAutomaticallyWhen` to dispatch its resume — see
     * `liveGateInteractionRef` in `useAgentChatSession`. The settle is NOT durable until that
     * dispatch lands (`busy` flips true); a records-changed relay tick landing in that gap must
     * not adopt a server transcript that predates it, or the local settle is silently discarded
     * and the parked interaction never resumes (bug: "Not now" firing zero network requests).
     */
    pendingResumeRef: MutableRefObject<unknown>
}) => {
    // Cache-first — when this tab opens with no locally-cached messages (a session this browser
    // never ran, or after a storage clear), hydrate once from the server (`queryRecords` → v6
    // messages) and seed. Locally-cached sessions skip the fetch, so no regression for own runs.
    // A to-be-hydrated session (empty local cache, not brand-new) shows a transcript skeleton
    // instead of the "start a chat" hero, so a session WITH server history doesn't flash the empty
    // state before its records land. Seeded synchronously so the first paint is already the skeleton.
    // Did a PREVIOUS mount leave a live chat behind? Read once, during the first render — this mount
    // publishes its own chat at commit, so reading it later would always say yes. A run preserved
    // across a route change is still streaming into the chat we just re-bound to, and a transcript
    // is only persisted on SETTLE, so `initialMessages` is empty mid-stream and hydration would
    // otherwise put the skeleton over the run we kept alive (#5724).
    const [resumedLiveChat] = useState(() => hasSessionChat(sessionId))
    const [isHydrating, setIsHydrating] = useState(
        () => initialMessages.length === 0 && !isSessionFresh(sessionId) && !resumedLiveChat,
    )
    // Set when server hydration for a KNOWN (non-fresh, uncached) session returns no records — its
    // durable history was pruned by retention or never persisted. Drives the "history unavailable"
    // notice so a wiped session isn't mistaken for a brand-new chat.
    const [hydratedEmpty, setHydratedEmpty] = useState(false)

    /**
     * The ONE adoption guard, shared by both paths below (they used to carry divergent copies, and
     * the hydration one had the same #5530 blind spot). Adopts the durable transcript when the
     * record log has grown past what we're rendering. Returns whether it adopted.
     */
    const adoptServerTranscript = useCallback(
        (transcript: unknown, {armJump = true} = {}): boolean => {
            if (!isSessionTranscript(transcript)) return false
            const {messages: serverMsgs, recordCount, sequenceCursor, interactionRows} = transcript
            const adopt = shouldAdoptServerTranscript({
                serverRecordCount: sequenceCursor ?? recordCount,
                serverMessageCount: serverMsgs.length,
                // A turn this browser only FAILED TO WATCH is not transcript the log has to beat:
                // counting a dead request's stamp makes the local copy look longer than the
                // server's, and the floor rule then pins the failure card on screen.
                localMessageCount: durableTranscriptMessages(messagesRef.current).length,
                watermark:
                    sequenceCursor === undefined
                        ? recordWatermarkRef.current
                        : sequenceWatermarkRef.current,
                busy: busyRef.current,
                // #5942: a card still parked on the user outranks the log — adopting over it
                // discards whatever they typed into its form.
                awaitingUser: shouldProtectRenderedInteraction(
                    messagesRef.current,
                    interactionRows,
                ),
            })
            if (!adopt) return false
            // Restored history renders settled (no live fade-in) and pinned to the bottom.
            serverMsgs.forEach((m) => {
                seenIdsRef.current.add(m.id)
                restoredIdsRef.current.add(m.id)
            })
            // Opening a session jumps to the live edge; a background catch-up must NOT — it would
            // yank a reader who scrolled up. Following the growth is `stickRef`'s call, the same
            // rule the live stream uses.
            if (armJump || intent.stickRef.current) intent.armJump()
            // Written synchronously, before any React commit. `messagesRef` lags a commit behind,
            // so two deliveries landing back-to-back (disk-restored result + background refetch)
            // can both see the pre-adoption transcript — it is this watermark, not the on-screen
            // length, that keeps the guard order-independent and stops an older snapshot from
            // clobbering a newer one.
            recordWatermarkRef.current = recordCount
            if (sequenceCursor !== undefined) sequenceWatermarkRef.current = sequenceCursor
            // The log just superseded what this tab was rendering, a failed request of our own
            // included. `useChat` holds that error until the next send and the session dot reads
            // it, so without this the dot stays red beside a finished turn.
            clearRunError()
            setMessages(serverMsgs)
            persistMessages({id: sessionId, messages: serverMsgs, recordCount})
            return true
        },
        // `intent`'s MEMBERS, not `intent`: `useScrollIntent` returns a fresh object every render,
        // so the object itself would recreate this callback each render and churn everything keyed
        // on it. `armJump` (useCallback []) and `stickRef` (useRef) are stable for the life of the
        // conversation.
        [
            sessionId,
            messagesRef,
            busyRef,
            seenIdsRef,
            restoredIdsRef,
            recordWatermarkRef,
            sequenceWatermarkRef,
            setMessages,
            persistMessages,
            clearRunError,
            intent.armJump,
            intent.stickRef,
        ],
    )
    // The remote-run poll below must NOT re-arm its timer on re-renders: the liveness query alone
    // re-renders this hook ~every 15s while a run is live elsewhere, and restarting a fresh 15s
    // timer on each of those starves the poll and resets its backoff. The effect reads the CURRENT
    // adopter through this ref and keys only on the poll's real inputs.
    const adoptServerTranscriptRef = useRef(adoptServerTranscript)
    adoptServerTranscriptRef.current = adoptServerTranscript

    // Every full read of the record log reports itself here, so the relay's `ready` can tell
    // "nobody has read this yet" from "we are reading it right now" (#6296).
    const logReadsInFlightRef = useRef(0)
    const logReadCompletedAtRef = useRef<number | undefined>(undefined)
    const readLog = useCallback(
        (onRestored?: (t: SessionTranscript | null) => void): Promise<SessionTranscript | null> => {
            logReadsInFlightRef.current += 1
            const settle = () => {
                logReadsInFlightRef.current -= 1
                logReadCompletedAtRef.current = Date.now()
            }
            return loadSessionMessages(sessionId, onRestored).then(
                (transcript) => {
                    settle()
                    return transcript
                },
                (error) => {
                    settle()
                    throw error
                },
            )
        },
        [sessionId],
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
        // Post-restore revalidation: the first result may be the disk-restored log (paints
        // instantly); adopt the background refetch when it lands. The refetch can land BEFORE the
        // promise handler below runs (both are microtasks racing), and `messagesRef` only catches
        // up on the next React commit — so record here, not via what's on screen, that real
        // history was already adopted.
        let adopted = false
        readLog((fresh) => {
            if (cancelled) return
            // The restore said "no records" but the server has some — clear the notice.
            if (adoptServerTranscript(fresh)) {
                adopted = true
                setHydratedEmpty(false)
            }
        })
            .then((transcript) => {
                if (cancelled) return
                if (!transcript || transcript.messages.length === 0) {
                    // Known session, but the server has no records for it → history was pruned or
                    // never persisted. Flag it so the transcript shows the "unavailable" notice.
                    // Only when nothing has been adopted yet — a refetch that already landed is
                    // real history, and this stale first result must not blank it out.
                    if (!adopted) setHydratedEmpty(true)
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
        // Seed once per mounted session tab; `sessionId` is stable for this instance.
    }, [sessionId, readLog])

    // SWR revalidate-on-open: a cached session paints instantly from localStorage; in the background
    // we refetch the durable records ONCE (low-priority) and adopt the server transcript when the
    // record log has grown past ours. Cache-MISS sessions are hydrated by the effect above; fresh
    // never-run sessions have no server records.
    //
    // The old count-based guard also carried a special case for "local tail paused, server tail
    // complete" — a resume that finished on another device, invisible to a message count. The
    // record watermark sees that growth directly, so the special case is gone rather than extended.
    useEffect(() => {
        if (initialMessages.length === 0 || isSessionFresh(sessionId)) return
        // As with the hydration effect above: no persistent ref, so StrictMode's double-mount
        // re-runs the revalidation rather than latching it out.
        let cancelled = false
        const adopt = (transcript: SessionTranscript | null) => {
            if (cancelled) return
            adoptServerTranscript(transcript)
        }
        // The first result may itself be the disk-restored records log; the callback re-applies
        // the same guarded adoption when the guaranteed background revalidation lands.
        readLog(adopt).then(adopt)
        return () => {
            cancelled = true
        }
        // Once per mounted session tab; `sessionId` is stable for this instance.
    }, [sessionId, readLog])

    // ── Follow a run happening somewhere else (#5530) ──────────────────────────
    // Live frames display immediately; durable polling converges events outside the frame subset.
    //
    // The settle stamp the derivation needs is written here rather than inside the package's
    // `setSessionStatusAtom`: this hook is mounted for the whole life of a session tab, which is
    // exactly when that session's local run-state can go non-idle, so mirroring the transition here
    // reproduces the package-side stamp without reaching into `@agenta/chat`.
    // `busy` stays as a second guard: it flips on the SEND commit, one commit before the status
    // atom the derivation reads, so it hides the strip a frame earlier when a local send takes over
    // a session that genuinely was running elsewhere.
    const liveness = useAtomValue(sessionLivenessAtomFamily(sessionId))
    const runningElsewhere = useAtomValue(sessionRunningElsewhereAtomFamily(sessionId)) && !busy

    useEffect(() => {
        if (!runningElsewhere) return
        let cancelled = false
        let timer: ReturnType<typeof setTimeout> | undefined
        let delay = REMOTE_RUN_POLL_MS
        const poll = async () => {
            let grew = false
            try {
                const adopt = adoptServerTranscriptRef.current
                const transcript = await readLog((fresh) => {
                    if (!cancelled && adopt(fresh, {armJump: false})) grew = true
                })
                if (!cancelled && adopt(transcript, {armJump: false})) grew = true
            } catch {
                // `loadSessionMessages` already swallows + logs; keep polling regardless.
            } finally {
                // Chained, not `setInterval`: the log is ~200KB and backend-slow, so a slow fetch
                // must never stack requests on top of itself.
                if (!cancelled) {
                    delay = grew ? REMOTE_RUN_POLL_MS : Math.min(delay * 2, REMOTE_RUN_POLL_MAX_MS)
                    timer = setTimeout(poll, delay)
                }
            }
        }
        // First tick fires NOW, not after REMOTE_RUN_POLL_MS: most turns finish inside 15s, and a
        // pending first tick is discarded by the cleanup below when the run ends — so a delayed
        // first tick meant short runs were often never fetched at all (#5624).
        void poll()
        return () => {
            cancelled = true
            if (timer) clearTimeout(timer)
        }
        // Deliberately NOT keyed on `adoptServerTranscript` — the poll reads it through the ref
        // above, so a re-render can't cancel a pending tick or reset the backoff.
    }, [runningElsewhere, sessionId])

    // One final catch-up on the falling edge (#5624). The poll above dies with `runningElsewhere`,
    // discarding any pending tick, so a run that ends between ticks would leave the last records
    // unfetched until a remount. Guarded adoption makes a spurious extra read harmless.
    const prevRemoteRunRef = useRef({sessionId, running: false})
    useEffect(() => {
        const prev = prevRemoteRunRef.current
        prevRemoteRunRef.current = {sessionId, running: runningElsewhere}
        if (prev.sessionId !== sessionId || !prev.running || runningElsewhere) return
        let cancelled = false
        const adopt = adoptServerTranscriptRef.current
        readLog((fresh) => {
            if (!cancelled) adopt(fresh, {armJump: false})
        }).then((transcript) => {
            if (!cancelled) adopt(transcript, {armJump: false})
        })
        return () => {
            cancelled = true
        }
    }, [runningElsewhere, sessionId])

    // ── Stranded first send (#6042) ─────────────────────────────────────────────
    // A restored transcript whose tail is an unanswered user turn, with the backend idle and the
    // durable record log EMPTY, means the send died client-side before it ever reached the runner
    // (aborted mid-prepare, a lost seed handoff). Without this check the session reads as
    // busy-forever on every reopen. One-shot per mount, but the shot only counts once the fetch is
    // CONCLUSIVE: `records: []` is a confirmed-empty log and stamps; `records: null` is a failed
    // fetch and never stamps — it retries a bounded burst, then re-arms so a later dependency
    // change can try again instead of latching the recovery out for the rest of the mount.
    const strandedCheckRef = useRef<"idle" | "pending" | "done">("idle")
    useEffect(() => {
        if (strandedCheckRef.current !== "idle" || isHydrating || busy) return
        if (liveness.isLoading || liveness.nest.isRunning) return
        if (!hasStrandedTail(messagesRef.current)) return
        strandedCheckRef.current = "pending"
        let cancelled = false
        let retryTimer: ReturnType<typeof setTimeout> | undefined
        let attempts = 0
        const check = () => {
            attempts += 1
            void getDefaultStore()
                .set(fetchSessionRecordsAtom, sessionId)
                .then(({records}) => {
                    if (cancelled) return
                    if (!records) {
                        if (attempts < STRANDED_CHECK_MAX_ATTEMPTS) {
                            retryTimer = setTimeout(check, STRANDED_CHECK_RETRY_MS)
                        } else {
                            strandedCheckRef.current = "idle"
                        }
                        return
                    }
                    strandedCheckRef.current = "done"
                    if (busyRef.current) return
                    if (records.length > 0) return
                    const current = messagesRef.current
                    if (!hasStrandedTail(current)) return
                    const stamped = [...current, strandedRunErrorCarrier()]
                    setMessages(stamped)
                    persistMessages({id: sessionId, messages: stamped})
                })
        }
        check()
        return () => {
            cancelled = true
            if (retryTimer) clearTimeout(retryTimer)
            // A dependency change mid-flight must retry, not deadlock on a shot that never
            // concluded.
            if (strandedCheckRef.current === "pending") strandedCheckRef.current = "idle"
        }
    }, [isHydrating, busy, liveness, sessionId, messagesRef, busyRef, setMessages, persistMessages])

    // ── Push counterpart to that poll: the session watch relay ─────────────────
    // The relay ticks whenever this session's durable records change — a turn resumed on another
    // device, an approval answered from mobile — so an open desktop tab converges in seconds instead
    // of needing a reload (the poll above stays the fallback, and only runs while a run is live).
    // One EventSource per ACTIVE conversation: antd Tabs keeps inactive panes mounted, so `enabled`
    // holds the subscription to the visible session. Foreground-only + throttled inside the hook.
    const scopeKey = useChatScopeKey()
    const activeSessionId = useAtomValue(activeSessionIdAtomFamily(scopeKey))
    const projectId = useAtomValue(projectIdAtom)
    const revalidateSessionRecords = useSetAtom(revalidateSessionRecordsAtom)
    const refreshFromRecords = useCallback(
        async (transcript?: SessionTranscript): Promise<boolean> => {
            const adoptOrConfirm = (candidate: unknown): boolean => {
                if (!isSessionTranscript(candidate)) return false
                const candidateWatermark = candidate.sequenceCursor ?? candidate.recordCount
                const currentWatermark =
                    candidate.sequenceCursor === undefined
                        ? recordWatermarkRef.current
                        : sequenceWatermarkRef.current
                return (
                    adoptServerTranscriptRef.current(candidate, {armJump: false}) ||
                    (currentWatermark ?? 0) >= candidateWatermark
                )
            }
            // Entry check: skip while THIS tab streams (already the live truth, `onFinish`
            // revalidates) OR a client-tool settle is already waiting on its resume dispatch — see
            // `shouldSkipRecordsRefresh`.
            if (
                shouldSkipRecordsRefresh({
                    busy: busyRef.current,
                    pendingResume: !!pendingResumeRef.current,
                })
            )
                return false
            if (isSessionTranscript(transcript)) {
                return adoptOrConfirm(transcript)
            }
            // A tick usually lands inside the records query's stale window, so the shared cache would
            // resolve unchanged; invalidate first, then adopt through the SAME guard as every other path.
            revalidateSessionRecords(sessionId)
            let refreshed: SessionTranscript | null
            try {
                refreshed = await readLog()
            } catch {
                return false
            }
            // Adoption-point recheck: the entry check above only covers the window BEFORE this
            // fetch started. `loadSessionMessages` is a real network round trip, and a client-tool
            // settle can land while it's in flight — without re-checking here, that settle arrives
            // busy=false/pendingResume=true, passes nothing, and this still clobbers it with stale data.
            if (
                shouldSkipRecordsRefresh({
                    busy: busyRef.current,
                    pendingResume: !!pendingResumeRef.current,
                })
            )
                return false
            // A background catch-up must not yank a reader who scrolled up — as with the poll.
            return adoptOrConfirm(refreshed)
        },
        [
            sessionId,
            busyRef,
            pendingResumeRef,
            recordWatermarkRef,
            sequenceWatermarkRef,
            revalidateSessionRecords,
            readLog,
        ],
    )
    // `ready` fires on every connect — each tab activation, each return to the foreground — so it
    // must not repeat a read the mount is already doing. A change that lands after the subscribe
    // arrives as `records-changed`, which is never skipped (#6296).
    const refreshOnReady = useCallback(() => {
        if (
            !shouldRefreshOnReady({
                inFlight: logReadsInFlightRef.current > 0,
                lastLoadedAt: logReadCompletedAtRef.current,
                now: Date.now(),
            })
        )
            return
        refreshFromRecords()
    }, [refreshFromRecords])
    useSessionRecordsWatch({
        sessionId,
        projectId,
        // #5919 relay; this surface re-reads records on any interaction change.
        onInteractionChanged: () => {
            revalidateSessionRecords(sessionId)
        },
        enabled: activeSessionId === sessionId,
        onReady: refreshOnReady,
        onRecordsChanged: () => {
            void refreshFromRecords()
        },
    })

    return {
        isHydrating,
        hydratedEmpty,
        runningElsewhere,
        stopStateLoading: liveness.isLoading,
        sessionTurnId: liveness.turnId,
        stoppingTurnId: liveness.stoppingTurnId,
        sharedReaderAdvertised: liveness.sharedReader,
        refreshFromRecords,
    }
}
