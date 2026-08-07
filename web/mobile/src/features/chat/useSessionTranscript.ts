import {useCallback, useEffect, useRef, useState} from "react"

import {loadSessionMessages} from "@agenta/chat/assets"
import {revalidateSessionRecordsAtom} from "@agenta/entities/session"
import type {UIMessage} from "ai"
import {getDefaultStore} from "jotai"

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

    useEffect(() => {
        let cancelled = false
        let refreshed = false
        setState("loading")
        setMessages([])
        void loadSessionMessages(sessionId, (fresh) => {
            // Disk-restore revalidation re-delivery — fresh is non-empty by contract.
            if (cancelled) return
            refreshed = true
            setMessages(fresh)
            setState("ready")
        }).then((msgs) => {
            // A fast revalidation can beat this one-shot resolve; never clobber it.
            if (cancelled || refreshed) return
            setMessages(msgs ?? [])
            setState(msgs && msgs.length > 0 ? "ready" : "empty")
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
        void loadSessionMessages(sessionId)
            .then((msgs) => {
                if (sessionRef.current === sessionId && msgs && msgs.length > 0) {
                    setMessages(msgs)
                    setState("ready")
                }
            })
            .finally(() => {
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
