import {useEffect, useState} from "react"

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
 */
export const useSessionTranscript = (sessionId: string, pollMs = 0) => {
    const [messages, setMessages] = useState<UIMessage[]>([])
    const [state, setState] = useState<"loading" | "ready" | "empty">("loading")
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

    useEffect(() => {
        if (!pollMs) return
        let cancelled = false
        let inFlight = false
        const store = getDefaultStore()
        const tick = () => {
            if (document.visibilityState !== "visible" || inFlight) return
            inFlight = true
            // Invalidate first so the shared-cache read refetches instead of serving staleTime.
            store.set(revalidateSessionRecordsAtom, sessionId)
            void loadSessionMessages(sessionId)
                .then((msgs) => {
                    if (!cancelled && msgs && msgs.length > 0) {
                        setMessages(msgs)
                        setState("ready")
                    }
                })
                .finally(() => {
                    inFlight = false
                })
        }
        const handle = setInterval(tick, pollMs)
        return () => {
            cancelled = true
            clearInterval(handle)
        }
    }, [sessionId, pollMs])

    return {messages, state}
}
