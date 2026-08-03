// Copied verbatim from web/oss/src/components/AgentChatSlice/assets/loadSession.ts (2026-07-25);
// the OSS original remains authoritative for the desktop chat until the re-plumb PR deletes it.
// Keep byte-parity if either side changes.
// Adaptations: none — `fetchSessionRecordsAtom` already reads `projectIdAtom` internally from
// `@agenta/entities/session` (an allowed package dep), so no OSS-app-only import is involved and
// no signature change was needed.
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
 *
 * The records query is disk-persisted (IndexedDB): a warm reload resolves instantly from the
 * restored log, and the entities layer guarantees one background revalidation (disk is never
 * authoritative). Because this return is a one-shot copy, `onRefreshed` re-delivers the
 * transcript when that revalidation lands — callers apply it behind their own adoption guards.
 */
export const loadSessionMessages = async (
    sessionId: string,
    onRefreshed?: (messages: UIMessage[]) => void,
): Promise<UIMessage[] | null> => {
    // Fetch through the shared records query cache (same key as `sessionRecordsQueryFamily`) so
    // hydration, revalidation, and the Inspector's atom subscribers share ONE network flight per
    // stale window instead of each issuing a raw duplicate request. A failure resolves to `null`
    // (the documented "request failed" contract) so the caller shows the history-unavailable
    // notice instead of leaking an unhandled rejection.
    try {
        const {records, refreshed} = await getDefaultStore().set(fetchSessionRecordsAtom, sessionId)
        if (refreshed && onRefreshed) {
            void refreshed
                .then((fresh) => {
                    if (!fresh || fresh.length === 0) return
                    const freshMsgs = transcriptToMessages(fresh)
                    if (freshMsgs && freshMsgs.length > 0) onRefreshed(freshMsgs)
                })
                // This chain outlives the function, so the try/catch below cannot see it. A
                // failed revalidation keeps whatever the cache already restored; without this
                // it surfaces as an unhandled rejection.
                .catch((err) => {
                    console.warn("[loadSessionMessages] revalidation failed:", err)
                })
        }
        if (!records || records.length === 0) return null
        return transcriptToMessages(records)
    } catch (err) {
        console.warn("[loadSessionMessages] hydration fetch failed:", err)
        return null
    }
}
