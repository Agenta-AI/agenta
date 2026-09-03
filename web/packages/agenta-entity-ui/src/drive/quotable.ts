/**
 * Marks a file body quotable: the data attributes the selection watcher reads, the raw source it
 * resolves line numbers against, and the staleness check that flips a quote's `changed` badge when
 * the file's content refetches into something the excerpt no longer matches.
 *
 * Only text-family bodies (markdown, plain text, code) opt in — the rest have no text to select.
 */
import {
    isQuoteReplyEnabled,
    useFileQuoteFreshness,
    useQuoteSource,
} from "@agenta/ui/quote-selection"

import {useDriveSessionId} from "./driveSessionContext"

export const useQuotableFile = (
    path: string,
    displayPath: string | undefined,
    content: string | undefined,
) => {
    const sessionId = useDriveSessionId()
    const enabled = isQuoteReplyEnabled()
    const key = enabled ? `file:${path}` : null
    useQuoteSource(key, content)
    useFileQuoteFreshness(enabled ? sessionId : null, path, content)
    // Outside a conversation (the standalone Files drawer) there is nothing to reply into, so the
    // body is left unmarked and only Copy — the browser's own — remains.
    if (!enabled || !sessionId) return {}
    return {
        "data-quotable": "true",
        "data-quote-kind": "file",
        "data-quote-source": key ?? undefined,
        "data-quote-path": path,
        "data-quote-display-path": displayPath ?? path,
    } as const
}
