import {type MutableRefObject, useCallback, useEffect, useRef, useState} from "react"

import {shouldAdoptServerTranscript} from "@agenta/entities/session"
import {type UIMessage} from "ai"
import {useAtomValue} from "jotai"

import {loadSessionMessages, type SessionTranscript} from "../assets/loadSession"
import {sessionLivenessAtomFamily} from "../state/liveness"
import {isSessionFresh} from "../state/sessionEphemera"

import {type ScrollIntent} from "./useScrollIntent"

/** Catch-up cadence while a session runs elsewhere — matches the records query's own staleTime and
 * the liveness poll, so a tick refetches instead of resolving from a still-fresh cache. */
const REMOTE_RUN_POLL_MS = 15_000

/** Ceiling once the log goes quiet. `is_running` is Redis-TTL'd at an hour (the runner clears it at
 * turn end; the TTL is only the crash backstop), so a runner that dies mid-turn leaves the flag set
 * for a long time — without a backoff that is a full-log refetch every 15s for an hour. Real growth
 * resets to the fast cadence, so a long turn that is simply quiet (a slow tool call emits no
 * records until it returns) is still followed. */
const REMOTE_RUN_POLL_MAX_MS = 60_000

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
    busy,
    setMessages,
    persistMessages,
    intent,
}: {
    sessionId: string
    initialMessages: UIMessage[]
    messagesRef: MutableRefObject<UIMessage[]>
    busyRef: MutableRefObject<boolean>
    seenIdsRef: MutableRefObject<Set<string>>
    restoredIdsRef: MutableRefObject<Set<string>>
    /** Records the rendered transcript was built from; `undefined` once a live turn supersedes it. */
    recordWatermarkRef: MutableRefObject<number | undefined>
    /** THIS browser is streaming the turn — reactive, so the catch-up poll can start/stop on it. */
    busy: boolean
    setMessages: (messages: UIMessage[]) => void
    persistMessages: (args: {id: string; messages: UIMessage[]; recordCount?: number}) => void
    intent: ScrollIntent
}) => {
    // Cache-first — when this tab opens with no locally-cached messages (a session this browser
    // never ran, or after a storage clear), hydrate once from the server (`queryRecords` → v6
    // messages) and seed. Locally-cached sessions skip the fetch, so no regression for own runs.
    // A to-be-hydrated session (empty local cache, not brand-new) shows a transcript skeleton
    // instead of the "start a chat" hero, so a session WITH server history doesn't flash the empty
    // state before its records land. Seeded synchronously so the first paint is already the skeleton.
    const [isHydrating, setIsHydrating] = useState(
        () => initialMessages.length === 0 && !isSessionFresh(sessionId),
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
        (transcript: SessionTranscript | null, {armJump = true} = {}): boolean => {
            if (!transcript) return false
            const {messages: serverMsgs, recordCount} = transcript
            const adopt = shouldAdoptServerTranscript({
                serverRecordCount: recordCount,
                serverMessageCount: serverMsgs.length,
                localMessageCount: messagesRef.current.length,
                watermark: recordWatermarkRef.current,
                busy: busyRef.current,
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
            setMessages,
            persistMessages,
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

    useEffect(() => {
        // A session created brand-new in this browser and not yet run has no backend records —
        // skip the guaranteed-empty query (cleared on first send; after a reload it re-hydrates).
        if (initialMessages.length > 0 || isSessionFresh(sessionId)) {
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
        loadSessionMessages(sessionId, (fresh) => {
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
    }, [sessionId])

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
        loadSessionMessages(sessionId, adopt).then(adopt)
        return () => {
            cancelled = true
        }
        // Once per mounted session tab; `sessionId` is stable for this instance.
    }, [sessionId])

    // ── Follow a run happening somewhere else (#5530) ──────────────────────────
    // There is no push channel to browsers: the runner publishes every event to Redis, but the only
    // consumer is the ingest worker that writes them to the DB. So a session driven from another tab
    // or device is followed by re-reading the durable log on a timer, and the adoption guard above
    // decides whether anything actually changed. `isRunning` also covers OUR stream, so exclude the
    // case where this browser is the one driving.
    const {nest} = useAtomValue(sessionLivenessAtomFamily(sessionId))
    const runningElsewhere = nest.isRunning && !busy

    useEffect(() => {
        if (!runningElsewhere) return
        let cancelled = false
        let timer: ReturnType<typeof setTimeout> | undefined
        let delay = REMOTE_RUN_POLL_MS
        const poll = async () => {
            let grew = false
            try {
                const adopt = adoptServerTranscriptRef.current
                const transcript = await loadSessionMessages(sessionId, (fresh) => {
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
        loadSessionMessages(sessionId, (fresh) => {
            if (!cancelled) adopt(fresh, {armJump: false})
        }).then((transcript) => {
            if (!cancelled) adopt(transcript, {armJump: false})
        })
        return () => {
            cancelled = true
        }
    }, [runningElsewhere, sessionId])

    return {isHydrating, hydratedEmpty, runningElsewhere}
}
