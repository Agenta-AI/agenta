import {useDeferredValue, useEffect} from "react"

import {findInSource} from "@agenta/shared/quotes"

import {getQuotes, updateQuote} from "./store"

/** Flags a file quote `stale` once the file no longer contains its excerpt. */
export const useFileQuoteFreshness = (
    sessionId: string | null,
    path: string,
    content: string | undefined,
) => {
    // Deferred: in the editors `content` is the live draft, which changes per keystroke.
    const settled = useDeferredValue(content)
    useEffect(() => {
        if (!sessionId || typeof settled !== "string") return
        getQuotes(sessionId).forEach((quote) => {
            if (quote.source.kind !== "file" || quote.source.path !== path) return
            const stale = findInSource(settled, quote.text) === null
            if (stale !== quote.stale) updateQuote(sessionId, quote.id, {stale})
        })
    }, [sessionId, path, settled])
}
