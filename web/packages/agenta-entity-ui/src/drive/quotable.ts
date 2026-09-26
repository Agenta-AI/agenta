// Marks a text-family file body quotable: data attributes, raw source, staleness.
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
    // Outside a conversation there is nothing to reply into.
    if (!sessionId) return {}
    return {
        "data-quotable": "true",
        "data-quote-kind": "file",
        "data-quote-source": key,
        "data-quote-path": path,
        "data-quote-display-path": displayPath ?? path,
    } as const
}
