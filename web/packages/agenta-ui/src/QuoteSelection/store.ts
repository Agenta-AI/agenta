/**
 * Staged quotes, per session, in a module-level Map — the same shape and lifetime as the composer
 * drafts and held messages they sit beside (`sessionEphemera` in @agenta/chat). Deliberately NOT a
 * jotai atom: a session-tab switch drops atom scope, which would strand the draft with its quotes
 * gone — read as a bug rather than as cleanup. In-memory, page-session lifetime.
 *
 * It lives in @agenta/ui rather than @agenta/chat because BOTH callers need it and one of them
 * (the drive file preview, in @agenta/entity-ui) sits below the chat package.
 */
import {useCallback, useSyncExternalStore} from "react"

import type {Quote} from "@agenta/shared/quotes"

const quotesBySession = new Map<string, Quote[]>()
const listeners = new Map<string, Set<() => void>>()

const EMPTY: Quote[] = []

const emit = (sessionId: string) => listeners.get(sessionId)?.forEach((fn) => fn())

const write = (sessionId: string, next: Quote[]) => {
    if (next.length > 0) quotesBySession.set(sessionId, next)
    else quotesBySession.delete(sessionId)
    emit(sessionId)
}

export const getQuotes = (sessionId: string): Quote[] => quotesBySession.get(sessionId) ?? EMPTY

export const addQuote = (sessionId: string, quote: Quote) => {
    write(sessionId, [...getQuotes(sessionId), quote])
}

export const updateQuote = (sessionId: string, id: string, patch: Partial<Quote>) => {
    const current = getQuotes(sessionId)
    if (!current.some((quote) => quote.id === id)) return
    write(
        sessionId,
        current.map((quote) => (quote.id === id ? {...quote, ...patch} : quote)),
    )
}

export const removeQuote = (sessionId: string, id: string) => {
    write(
        sessionId,
        getQuotes(sessionId).filter((quote) => quote.id !== id),
    )
}

export const clearQuotes = (sessionId: string) => write(sessionId, [])

/** Put a set back after a send that never happened — the counterpart of `clearQuotes`. */
export const restoreQuotes = (sessionId: string, quotes: Quote[]) => write(sessionId, quotes)

/** Mark every quote taken from a message stale — its turn was rewound or replaced. */
export const markMessageQuotesStale = (sessionId: string, messageId: string) => {
    const current = getQuotes(sessionId)
    if (!current.some((q) => q.source.kind === "message" && q.source.messageId === messageId)) return
    write(
        sessionId,
        current.map((quote) =>
            quote.source.kind === "message" && quote.source.messageId === messageId
                ? {...quote, stale: true}
                : quote,
        ),
    )
}

export const subscribeQuotes = (sessionId: string, fn: () => void) => {
    const set = listeners.get(sessionId) ?? new Set()
    listeners.set(sessionId, set)
    set.add(fn)
    return () => {
        set.delete(fn)
        if (set.size === 0) listeners.delete(sessionId)
    }
}

/** Every quote held for this session, draft and staged alike. */
export const useSessionQuotes = (sessionId: string | null | undefined): Quote[] => {
    const subscribe = useCallback(
        (fn: () => void) => (sessionId ? subscribeQuotes(sessionId, fn) : () => {}),
        [sessionId],
    )
    const snapshot = useCallback(() => (sessionId ? getQuotes(sessionId) : EMPTY), [sessionId])
    return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/** Only what the composer should show as chips. */
export const useStagedQuotes = (sessionId: string | null | undefined): Quote[] =>
    useSessionQuotes(sessionId).filter((quote) => quote.staged)

/** Drop every quote a permanently deleted session was holding. */
export const clearSessionQuotes = (sessionId: string) => {
    quotesBySession.delete(sessionId)
    emit(sessionId)
}
