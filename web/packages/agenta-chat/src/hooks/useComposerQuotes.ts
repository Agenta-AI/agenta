/**
 * The composer's half of quote-to-reply: which quotes are staged for this session, how one is
 * removed, and how the set is consumed by a send.
 *
 * `take` clears on SUCCESS, not on submit — a send can fail, and an edit session sends nothing at
 * all — so the caller hands the set back with `restore` when the message never left, the same
 * contract the attachment tray already provides.
 */
import {useCallback} from "react"

import type {Quote} from "@agenta/shared/quotes"
import {clearQuotes, getQuotes, removeQuote, restoreQuotes, useStagedQuotes} from "@agenta/ui/quote-selection"

export const useComposerQuotes = (sessionId: string | null | undefined) => {
    const quotes = useStagedQuotes(sessionId)

    const remove = useCallback(
        (id: string) => {
            if (sessionId) removeQuote(sessionId, id)
        },
        [sessionId],
    )

    /** Read the staged set without consuming it — the caller clears once the send lands. */
    const peek = useCallback(
        (): Quote[] => (sessionId ? getQuotes(sessionId).filter((q) => q.staged) : []),
        [sessionId],
    )

    const clear = useCallback(() => {
        if (sessionId) clearQuotes(sessionId)
    }, [sessionId])

    const restore = useCallback(
        (held: Quote[]) => {
            if (sessionId && held.length) restoreQuotes(sessionId, held)
        },
        [sessionId],
    )

    return {quotes, remove, peek, clear, restore}
}
