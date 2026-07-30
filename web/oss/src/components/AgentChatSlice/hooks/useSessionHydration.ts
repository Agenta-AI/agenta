import {type MutableRefObject, useEffect, useState} from "react"

import {type UIMessage} from "ai"

import {loadSessionMessages} from "../assets/loadSession"
import {getPendingApprovals} from "../components/ApprovalDock"
import {isSessionFresh} from "../state/sessionEphemera"

import {type ScrollIntent} from "./useScrollIntent"

/**
 * Hybrid history for one session tab. localStorage holds only the session INDEX; the durable
 * conversation CONTENT lives in the backend record log — so a tab either paints from cache and
 * revalidates (SWR), or hydrates from the server once (cache miss). Both paths adopt the server
 * transcript under the same guards: never mid-stream, and never behind what's on screen.
 */
export const useSessionHydration = ({
    sessionId,
    initialMessages,
    messagesRef,
    busyRef,
    seenIdsRef,
    restoredIdsRef,
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
    setMessages: (messages: UIMessage[]) => void
    persistMessages: (args: {id: string; messages: UIMessage[]}) => void
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
        // instantly); when the guaranteed background refetch lands, adopt it under the same
        // guards as the SWR effect below — never mid-stream, only when strictly ahead.
        const adoptRefreshed = (freshMsgs: UIMessage[]) => {
            if (cancelled || busyRef.current) return
            if (freshMsgs.length <= messagesRef.current.length) return
            freshMsgs.forEach((m) => {
                seenIdsRef.current.add(m.id)
                restoredIdsRef.current.add(m.id)
            })
            intent.armJump()
            // The restore said "no records" but the server has some — clear the notice.
            setHydratedEmpty(false)
            setMessages(freshMsgs)
            persistMessages({id: sessionId, messages: freshMsgs})
        }
        loadSessionMessages(sessionId, adoptRefreshed)
            .then((msgs) => {
                if (cancelled) return
                if (!msgs || msgs.length === 0) {
                    // Known session, but the server has no records for it → history was pruned or
                    // never persisted. Flag it so the transcript shows the "unavailable" notice.
                    setHydratedEmpty(true)
                    return
                }
                // Restored history renders settled (no live fade-in) and pinned to the bottom.
                msgs.forEach((m) => {
                    seenIdsRef.current.add(m.id)
                    restoredIdsRef.current.add(m.id)
                })
                intent.armJump()
                setMessages(msgs)
                persistMessages({id: sessionId, messages: msgs})
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
    // we refetch the durable records ONCE (low-priority) and adopt the server transcript ONLY IF it's
    // strictly ahead of what we're showing (a turn finished on another device). We never clobber a
    // transcript that's live (`busyRef`), or that the server isn't strictly ahead of — so a local
    // optimistic/unsent tail is safe. Cache-MISS sessions are hydrated by the effect above; fresh
    // never-run sessions have no server records. Reconciliation is by message COUNT, not content:
    // detecting a same-length server-side edit/regenerate is deferred, as is focus/interval
    // revalidation. FOLLOWUP(sessions,swr): see docs/designs/sessions/frontend-integration.md.
    useEffect(() => {
        if (initialMessages.length === 0 || isSessionFresh(sessionId)) return
        // As with the hydration effect above: no persistent ref, so StrictMode's double-mount
        // re-runs the revalidation rather than latching it out.
        let cancelled = false
        const adopt = (serverMsgs: UIMessage[] | null) => {
            if (cancelled || !serverMsgs || serverMsgs.length === 0) return
            const prev = messagesRef.current
            if (busyRef.current) return
            // Adopt the server transcript when it is strictly ahead by count, OR when our LOCAL tail
            // is stuck paused (mid-approval) while the server has moved past it to a terminal turn — a
            // resume that completed on another device. Count alone misses the latter (same bubble
            // count) and was silently propped up by the now-removed duplicate user row; the server's
            // `paused` flag rides the runner's `done.stopReason` through `transcriptToMessages`.
            const serverAheadByCount = serverMsgs.length > prev.length
            const localTailPaused = getPendingApprovals(prev).length > 0
            const serverTail = serverMsgs[serverMsgs.length - 1] as
                | {role?: string; metadata?: {paused?: boolean}}
                | undefined
            // The paused-tail exception adopts a resume that completed elsewhere, so the server must
            // NOT be behind (>= guards against a lagging snapshot discarding newer local approval
            // state) and its tail must be a finished assistant turn — not a shorter, older stream.
            const serverTailComplete =
                serverMsgs.length >= prev.length &&
                serverTail?.role === "assistant" &&
                !serverTail.metadata?.paused &&
                getPendingApprovals(serverMsgs).length === 0
            if (!serverAheadByCount && !(localTailPaused && serverTailComplete)) return
            serverMsgs.forEach((m) => {
                seenIdsRef.current.add(m.id)
                restoredIdsRef.current.add(m.id)
            })
            intent.armJump()
            setMessages(serverMsgs)
            persistMessages({id: sessionId, messages: serverMsgs})
        }
        // The first result may itself be the disk-restored records log; the callback re-applies
        // the same guarded adoption when the guaranteed background revalidation lands.
        loadSessionMessages(sessionId, adopt).then(adopt)
        return () => {
            cancelled = true
        }
        // Once per mounted session tab; `sessionId` is stable for this instance.
    }, [sessionId])

    return {isHydrating, hydratedEmpty}
}
