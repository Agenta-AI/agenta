/**
 * Staleness — the `source changed` badge the design shows but nothing derives on its own.
 *
 * A stale quote still sends; the badge only tells the user the source moved underneath it.
 */
import {useEffect} from "react"

import {findInSource} from "@agenta/shared/quotes"

import {getQuotes, updateQuote} from "./store"

/**
 * A file quote goes stale when the file's content refetches and the excerpt no longer matches.
 * `useDriveFileText` already revalidates, so this is a comparison on the query result.
 */
export const useFileQuoteFreshness = (
    sessionId: string | null,
    path: string,
    content: string | undefined,
) => {
    useEffect(() => {
        if (!sessionId || typeof content !== "string") return
        getQuotes(sessionId).forEach((quote) => {
            if (quote.source.kind !== "file" || quote.source.path !== path) return
            const stale = findInSource(content, quote.text) === null
            if (stale !== quote.stale) updateQuote(sessionId, quote.id, {stale})
        })
    }, [sessionId, path, content])
}

/**
 * A message quote goes stale when its turn leaves the transcript — a rewind, or the message being
 * replaced. `messageIds` is the live set of assistant message ids.
 */
export const useMessageQuoteFreshness = (sessionId: string | null, messageIds: string[]) => {
    const key = messageIds.join(",")
    useEffect(() => {
        if (!sessionId) return
        const live = new Set(key ? key.split(",") : [])
        getQuotes(sessionId).forEach((quote) => {
            if (quote.source.kind !== "message") return
            const stale = !live.has(quote.source.messageId)
            if (stale !== quote.stale) updateQuote(sessionId, quote.id, {stale})
        })
    }, [sessionId, key])
}
