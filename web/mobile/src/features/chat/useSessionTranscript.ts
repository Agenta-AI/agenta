import {useCallback, useEffect, useRef, useState} from "react"

import {loadSessionMessages, type SessionTranscript} from "@agenta/chat/assets"
import {revalidateSessionRecordsAtom} from "@agenta/entities/session"
import type {UIMessage} from "ai"
import {getDefaultStore} from "jotai"

import {adoptTranscriptRead, shouldAdoptTranscript} from "./transcriptAdoption"

/**
 * Read-only transcript for one session: server record replay via `loadSessionMessages`
 * (IndexedDB-restored, revalidation re-delivered through `onRefreshed`). `null` history
 * collapses into "empty" — raw text covers both no-messages and history-unavailable.
 *
 * `pollMs` > 0 tightens the cadence (a running turn / pending approval): each tick marks the
 * records stale and re-reads through the shared cache. Foreground-only — a hidden tab skips
 * ticks entirely (the records query is the heavy one; see the plan's cost note).
 *
 * The returned `refresh` is the tick's body as a stable callback, so the live relay
 * (`useSessionWatch`) can drive the exact same revalidate path push-style.
 */
export const useSessionTranscript = (sessionId: string, pollMs = 0) => {
    const [messages, setMessages] = useState<UIMessage[]>([])
    const [state, setState] = useState<"loading" | "ready" | "empty">("loading")
    // Session-switch guard: a late resolve for a previous session must never land.
    const sessionRef = useRef(sessionId)
    sessionRef.current = sessionId
    const inFlightRef = useRef(false)
    // A change event that lands mid-refresh must queue a trailing refresh — dropping it
    // can strand the FINAL transcript state forever (the turn's `ended` also kills the
    // tightened poll, so nothing else would ever re-read).
    const pendingRef = useRef(false)
    // What is on screen, read by the adoption guard: `messages` state lags a commit behind, so
    // two deliveries landing back-to-back would both see the pre-adoption transcript.
    const messagesRef = useRef<UIMessage[]>([])
    // Records the rendered transcript was built from; `undefined` until the first adoption. This
    // is in-memory only — mobile persists no transcript, so there is nothing to file it against.
    const recordCountRef = useRef<number | undefined>(undefined)
    const sequenceCursorRef = useRef<number | undefined>(undefined)

    /**
     * Apply one delivery behind the shared adoption rule (`shouldAdoptTranscript`). Returns
     * whether it adopted, so callers can tell "nothing on the server" from "already up to date".
     */
    const adopt = useCallback(
        (transcript: SessionTranscript | null): boolean => {
            // A late resolve for a previous session must never land.
            if (sessionRef.current !== sessionId) return false
            const shouldAdopt = shouldAdoptTranscript(transcript, {
                messageCount: messagesRef.current.length,
                recordCount: recordCountRef.current,
                sequenceCursor: sequenceCursorRef.current,
            })
            if (!shouldAdopt || !transcript) return false
            recordCountRef.current = transcript.recordCount
            if (transcript.sequenceCursor !== undefined)
                sequenceCursorRef.current = transcript.sequenceCursor
            messagesRef.current = transcript.messages
            setMessages(transcript.messages)
            setState("ready")
            return true
        },
        [sessionId],
    )
    // The poll/relay refresh below must not re-arm on every render, so it reads the current
    // adopter through a ref rather than closing over it.
    const adoptRef = useRef(adopt)
    adoptRef.current = adopt

    useEffect(() => {
        let cancelled = false
        // A fast revalidation can beat the one-shot resolve; the watermark keeps the two
        // deliveries order-independent, and this flag keeps a stale empty result from blanking
        // a transcript the revalidation already adopted.
        let adopted = false
        setState("loading")
        setMessages([])
        messagesRef.current = []
        recordCountRef.current = undefined
        sequenceCursorRef.current = undefined
        void loadSessionMessages(sessionId, (fresh) => {
            // Disk-restore revalidation re-delivery — fresh is non-empty by contract.
            if (cancelled) return
            if (adoptRef.current(fresh)) adopted = true
        })
            .then((transcript) => {
                if (cancelled) return
                if (adoptRef.current(transcript)) {
                    adopted = true
                    return
                }
                // Nothing adopted from either delivery → no durable history for this session.
                if (!adopted) setState("empty")
            })
            .catch(() => {
                if (!cancelled && !adopted) setState("empty")
            })
        return () => {
            cancelled = true
        }
    }, [sessionId])

    const refresh = useCallback(() => {
        if (document.visibilityState !== "visible") return
        if (inFlightRef.current) {
            pendingRef.current = true
            return
        }
        inFlightRef.current = true
        // Invalidate first so the shared-cache read refetches instead of serving staleTime.
        getDefaultStore().set(revalidateSessionRecordsAtom, sessionId)
        void adoptTranscriptRead(
            () => loadSessionMessages(sessionId),
            (transcript) => adoptRef.current(transcript),
        ).finally(() => {
            inFlightRef.current = false
            if (pendingRef.current) {
                pendingRef.current = false
                if (sessionRef.current === sessionId) refresh()
            }
        })
    }, [sessionId])

    useEffect(() => {
        if (!pollMs) return
        const handle = setInterval(refresh, pollMs)
        return () => {
            clearInterval(handle)
        }
    }, [refresh, pollMs])

    return {messages, state, refresh}
}
