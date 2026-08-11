import {type MutableRefObject, useCallback, useEffect, useRef, useState} from "react"

import {loadSessionMessages, type SessionTranscript} from "@agenta/chat/assets"
import {isSessionFresh, sessionStatusAtomFamily} from "@agenta/chat/state"
import {revalidateSessionRecordsAtom, shouldAdoptServerTranscript} from "@agenta/entities/session"
import {type UIMessage} from "ai"
import {useAtomValue, useSetAtom} from "jotai"

import {projectIdAtom} from "@/oss/state/project"

import {noteSessionLocalStatusAtom, sessionRunningElsewhereAtomFamily} from "../state/liveness"
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
    /** THIS browser is streaming the turn — reactive, so the catch-up poll can start/stop on it. */
    busy: boolean
    setMessages: (messages: UIMessage[]) => void
    persistMessages: (args: {id: string; messages: UIMessage[]; recordCount?: number}) => void
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
    // decides whether anything actually changed. `isRunning` also covers OUR stream, so the atom
    // excludes every case where this browser is the one driving (#5844).
    //
    // The settle stamp the derivation needs is written here rather than inside the package's
    // `setSessionStatusAtom`: this hook is mounted for the whole life of a session tab, which is
    // exactly when that session's local run-state can go non-idle, so mirroring the transition here
    // reproduces the package-side stamp without reaching into `@agenta/chat`.
    const localStatus = useAtomValue(sessionStatusAtomFamily(sessionId))
    const noteLocalStatus = useSetAtom(noteSessionLocalStatusAtom)
    useEffect(() => {
        noteLocalStatus({id: sessionId, status: localStatus})
    }, [sessionId, localStatus, noteLocalStatus])
    // Closing the tab mid-run settles the local run too (the stream is torn down on unmount), so
    // stamp it — otherwise a reopen would trust a liveness snapshot older than our own aborted turn.
    useEffect(
        () => () => noteLocalStatus({id: sessionId, status: "idle"}),
        [sessionId, noteLocalStatus],
    )
    // `busy` stays as a second guard: it flips on the SEND commit, one commit before the status
    // atom the derivation reads, so it hides the strip a frame earlier when a local send takes over
    // a session that genuinely was running elsewhere.
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
        timer = setTimeout(poll, delay)
        return () => {
            cancelled = true
            if (timer) clearTimeout(timer)
        }
        // Deliberately NOT keyed on `adoptServerTranscript` — the poll reads it through the ref
        // above, so a re-render can't cancel a pending tick or reset the backoff.
    }, [runningElsewhere, sessionId])

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
    const refreshFromRecords = useCallback(() => {
        // Entry check: skip while THIS tab streams (already the live truth, `onFinish`
        // revalidates) OR a client-tool settle is already waiting on its resume dispatch — see
        // `shouldSkipRecordsRefresh`.
        if (
            shouldSkipRecordsRefresh({
                busy: busyRef.current,
                pendingResume: !!pendingResumeRef.current,
            })
        )
            return
        // A tick usually lands inside the records query's stale window, so the shared cache would
        // resolve unchanged; invalidate first, then adopt through the SAME guard as every other path.
        revalidateSessionRecords(sessionId)
        void loadSessionMessages(sessionId).then((transcript) => {
            // Adoption-point recheck: the entry check above only covers the window BEFORE this
            // fetch started. `loadSessionMessages` is a real network round trip, and a client-tool
            // settle can land while it's in flight — without re-checking here, that settle arrives
            // busy=false/pendingResume=true, passes nothing, and this `.then` still clobbers it
            // with the (now stale) transcript it fetched before the settle happened.
            if (
                shouldSkipRecordsRefresh({
                    busy: busyRef.current,
                    pendingResume: !!pendingResumeRef.current,
                })
            )
                return
            // A background catch-up must not yank a reader who scrolled up — as with the poll.
            adoptServerTranscriptRef.current(transcript, {armJump: false})
        })
    }, [sessionId, busyRef, pendingResumeRef, revalidateSessionRecords])
    useSessionRecordsWatch({
        sessionId,
        projectId,
        enabled: activeSessionId === sessionId,
        onRecordsChanged: refreshFromRecords,
    })

    return {isHydrating, hydratedEmpty, runningElsewhere}
}
