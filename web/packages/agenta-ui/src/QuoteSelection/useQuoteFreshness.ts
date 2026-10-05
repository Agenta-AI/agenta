import {useDeferredValue, useEffect} from "react"

import {refreshFileQuote} from "@agenta/shared/quotes"

import {getQuotes, updateQuote} from "./store"

/** Keeps a file quote's line range on its excerpt as the file changes; `stale` once it is gone. */
export const useFileQuoteFreshness = (
    sessionId: string | null,
    mountId: string | undefined,
    path: string,
    content: string | undefined,
) => {
    // Deferred: in the editors `content` is the live draft, which changes per keystroke.
    const settled = useDeferredValue(content)
    useEffect(() => {
        if (!sessionId || typeof settled !== "string") return
        getQuotes(sessionId).forEach((quote) => {
            if (quote.source.kind !== "file" || quote.source.path !== path) return
            // Two mounts can hold the same relative path; only this file's quotes move with it.
            if ((quote.source.mountId ?? "") !== (mountId ?? "")) return
            const patch = refreshFileQuote(quote, settled)
            if (patch) updateQuote(sessionId, quote.id, patch)
        })
    }, [sessionId, mountId, path, settled])
}
