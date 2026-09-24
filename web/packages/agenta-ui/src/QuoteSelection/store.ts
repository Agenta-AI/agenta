// Held quotes per session, module-level like `sessionEphemera`: they outlive a tab switch.
import {useCallback, useMemo, useSyncExternalStore} from "react"

import type {Quote} from "@agenta/shared/quotes"

const quotesBySession = new Map<string, Quote[]>()
const listeners = new Map<string, Set<() => void>>()
const submitters = new Map<string, () => boolean>()

const EMPTY: Quote[] = []

const emit = (sessionId: string) => listeners.get(sessionId)?.forEach((fn) => fn())

const write = (sessionId: string, next: Quote[]) => {
    if (next.length > 0) quotesBySession.set(sessionId, next)
    else quotesBySession.delete(sessionId)
    emit(sessionId)
}

export const getQuotes = (sessionId: string): Quote[] => quotesBySession.get(sessionId) ?? EMPTY

export const addQuote = (sessionId: string, quote: Quote) =>
    write(sessionId, [...getQuotes(sessionId), quote])

export const updateQuote = (sessionId: string, id: string, patch: Partial<Quote>) => {
    const current = getQuotes(sessionId)
    if (!current.some((quote) => quote.id === id)) return
    write(
        sessionId,
        current.map((quote) => (quote.id === id ? {...quote, ...patch} : quote)),
    )
}

export const removeQuote = (sessionId: string, id: string) =>
    write(
        sessionId,
        getQuotes(sessionId).filter((quote) => quote.id !== id),
    )

/** Consume the staged set on a send. */
export const clearQuotes = (sessionId: string) =>
    write(
        sessionId,
        getQuotes(sessionId).filter((quote) => !quote.staged),
    )

/** Drop everything a permanently deleted session held. */
export const clearSessionQuotes = (sessionId: string) => write(sessionId, [])

const subscribeQuotes = (sessionId: string, fn: () => void) => {
    const set = listeners.get(sessionId) ?? new Set()
    listeners.set(sessionId, set)
    set.add(fn)
    return () => {
        set.delete(fn)
        if (set.size === 0) listeners.delete(sessionId)
    }
}

export const useSessionQuotes = (sessionId: string | null | undefined): Quote[] => {
    const subscribe = useCallback(
        (fn: () => void) => (sessionId ? subscribeQuotes(sessionId, fn) : () => {}),
        [sessionId],
    )
    const snapshot = useCallback(() => (sessionId ? getQuotes(sessionId) : EMPTY), [sessionId])
    return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export const useStagedQuotes = (sessionId: string | null | undefined): Quote[] => {
    const quotes = useSessionQuotes(sessionId)
    return useMemo(() => quotes.filter((quote) => quote.staged), [quotes])
}

/** The composer registers its "send now" per session; the note box's Enter calls it. */
export const registerQuoteSubmit = (sessionId: string, submit: () => boolean) => {
    submitters.set(sessionId, submit)
    return () => {
        if (submitters.get(sessionId) === submit) submitters.delete(sessionId)
    }
}

/** False when no composer can send now; the quote then stays staged. */
export const submitSessionMessage = (sessionId: string): boolean => {
    const submit = submitters.get(sessionId)
    return typeof submit === "function" ? submit() : false
}
