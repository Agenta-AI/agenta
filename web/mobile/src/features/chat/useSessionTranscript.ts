import {useEffect, useState} from "react"

import {loadSessionMessages} from "@agenta/chat/assets"
import type {UIMessage} from "ai"

/**
 * Read-only transcript for one session: server record replay via `loadSessionMessages`
 * (IndexedDB-restored, revalidation re-delivered through `onRefreshed`). `null` history
 * collapses into "empty" — raw text covers both no-messages and history-unavailable.
 */
export const useSessionTranscript = (sessionId: string) => {
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
    return {messages, state}
}
