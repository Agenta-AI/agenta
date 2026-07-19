import {fetchSessionRecordsAtom} from "@agenta/entities/session"
import type {UIMessage} from "ai"
import {getDefaultStore} from "jotai"

import {transcriptToMessages} from "./transcriptToMessages"

/**
 * Server-side hydration seam for a session's conversation.
 *
 * The durable Sessions API (PR #4916) persists every ACP `AgentEvent` to an append-only
 * record log; `queryRecords` is the replay source. This maps those events to v6 `UIMessage[]`
 * (see `transcriptToMessages`) so opening a session from a deep link / observability trace
 * renders a conversation this browser never ran.
 *
 * Returns `null` when there is no server history (project scope missing, request failed, or
 * the record log is empty — e.g. the ingest worker isn't running locally). The caller then
 * falls back to whatever is already in localStorage.
 */
export const loadSessionMessages = async (sessionId: string): Promise<UIMessage[] | null> => {
    // Fetch through the shared records query cache (same key as `sessionRecordsQueryFamily`) so
    // hydration, revalidation, and the Inspector's atom subscribers share ONE network flight per
    // stale window instead of each issuing a raw duplicate request. A failure resolves to `null`
    // (the documented "request failed" contract) so the caller shows the history-unavailable
    // notice instead of leaking an unhandled rejection.
    try {
        const records = await getDefaultStore().set(fetchSessionRecordsAtom, sessionId)
        if (!records || records.length === 0) return null
        return transcriptToMessages(records)
    } catch (err) {
        console.warn("[loadSessionMessages] hydration fetch failed:", err)
        return null
    }
}
