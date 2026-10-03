// Marks a text-family file body quotable: data attributes, raw source, staleness.
import type {Mount} from "@agenta/entities/session"
import {useFileQuoteFreshness, useQuoteSource} from "@agenta/ui/quote-selection"

import {useDriveSessionId} from "./driveSessionContext"

export const useQuotableFile = (
    mount: Mount | null,
    path: string,
    displayPath: string | undefined,
    content: string | undefined,
) => {
    const sessionId = useDriveSessionId()
    const mountId = mount?.id
    // The session cwd and `agent-files/` can hold the same relative path; the mount tells them apart.
    const key = `file:${mountId ?? ""}:${path}`
    useQuoteSource(key, content)
    useFileQuoteFreshness(sessionId, mountId, path, content)
    // Outside a conversation there is nothing to reply into.
    if (!sessionId) return {}
    return {
        "data-quotable": "true",
        "data-quote-kind": "file",
        "data-quote-source": key,
        "data-quote-path": path,
        "data-quote-display-path": displayPath ?? path,
        "data-quote-mount": mountId,
    } as const
}
