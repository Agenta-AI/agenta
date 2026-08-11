import {
    fetchSessionInteractionStatesAtom,
    fetchSessionRecordsAtom,
    type SessionInteractionRowStates,
} from "@agenta/entities/session"
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
 *
 * The records query is disk-persisted (IndexedDB): a warm reload resolves instantly from the
 * restored log, and the entities layer guarantees one background revalidation (disk is never
 * authoritative). Because this return is a one-shot copy, `onRefreshed` re-delivers the
 * transcript when that revalidation lands — callers apply it behind their own adoption guards.
 */
export interface SessionTranscript {
    messages: UIMessage[]
    /**
     * How many durable records this transcript was built from. The log is append-only and ordered,
     * so this is an EXACT "has the server moved on?" watermark — unlike a message count, which
     * `transcriptToMessages` deliberately holds flat while a turn grows (issue #5530).
     */
    recordCount: number
    /**
     * The interaction lifecycle rows this transcript was replayed against. Records never carry a
     * row's later lifecycle, so this is the only place the adoption guard can see whether a card is
     * still awaiting the user (`pending`) or has ended. Empty when the fetch failed or the
     * session has no rows; the two cases are indistinguishable here.
     */
    interactionRows?: SessionInteractionRowStates
}

export const loadSessionMessages = async (
    sessionId: string,
    onRefreshed?: (transcript: SessionTranscript) => void,
): Promise<SessionTranscript | null> => {
    // Fetch through the shared records query cache (same key as `sessionRecordsQueryFamily`) so
    // hydration, revalidation, and the Inspector's atom subscribers share ONE network flight per
    // stale window instead of each issuing a raw duplicate request. A failure resolves to `null`
    // (the documented "request failed" contract) so the caller shows the history-unavailable
    // notice instead of leaking an unhandled rejection.
    try {
        const store = getDefaultStore()
        // The best-effort lifecycle join must never gate transcript loading.
        const [{records, refreshed}, interactionRowStates] = await Promise.all([
            store.set(fetchSessionRecordsAtom, sessionId),
            store.set(fetchSessionInteractionStatesAtom, sessionId),
        ])
        if (refreshed && onRefreshed) {
            void refreshed.then((fresh) => {
                if (!fresh || fresh.length === 0) return
                const freshMsgs = transcriptToMessages(fresh, {interactionRowStates})
                if (freshMsgs && freshMsgs.length > 0) {
                    onRefreshed({
                        messages: freshMsgs,
                        recordCount: fresh.length,
                        interactionRows: interactionRowStates,
                    })
                }
            })
        }
        if (!records || records.length === 0) return null
        const messages = transcriptToMessages(records, {interactionRowStates})
        return messages
            ? {messages, recordCount: records.length, interactionRows: interactionRowStates}
            : null
    } catch (err) {
        console.warn("[loadSessionMessages] hydration fetch failed:", err)
        return null
    }
}
