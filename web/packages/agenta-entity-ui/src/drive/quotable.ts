/**
 * Marks a file body quotable: the data attributes the selection watcher reads, the raw source it
 * resolves line numbers against, and the staleness check that flips a quote's `changed` badge when
 * the file's content refetches into something the excerpt no longer matches.
 *
 * Only text-family bodies (markdown, plain text, code) opt in — the rest have no text to select.
 */
import {useFileQuoteFreshness, useQuoteSource} from "@agenta/ui/quote-selection"

import {useDriveSessionId} from "./driveSessionContext"

export const useQuotableFile = (
    path: string,
    displayPath: string | undefined,
    content: string | undefined,
) => {
    const sessionId = useDriveSessionId()
    const key = `file:${path}`
    useQuoteSource(key, content)
    useFileQuoteFreshness(sessionId, path, content)
    // Outside a conversation (the standalone Files drawer) there is nothing to reply into, so the
    // body is left unmarked and only Copy — the browser's own — remains.
    if (!sessionId) return {}
    return {
        "data-quotable": "true",
        "data-quote-kind": "file",
        "data-quote-source": key,
        "data-quote-path": path,
        "data-quote-display-path": displayPath ?? path,
    } as const
}
