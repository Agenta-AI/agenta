// Canonical since the desktop re-plumb: the OSS copy is deleted and both apps import this.
// Adaptations: none — `fetchSessionRecordsAtom`/`fetchSessionInteractionStatesAtom` already read
// `projectIdAtom` internally from `@agenta/entities/session` (an allowed package dep), so no
// OSS-app-only import is involved and no signature change was needed.
// Re-synced 2026-08-10: interaction rows now provide replay lifecycle and saved outcomes.
import {
    fetchSessionInteractionStatesAtom,
    fetchSessionRecordsAtom,
    revalidateSessionInteractionsAtom,
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
     * How many durable records this transcript was built from. This remains distinct from the
     * sequence cursor because retention can hold the row count flat while the log moves forward.
     */
    recordCount: number
    /**
     * Highest durable sequence covered by this transcript. Undefined for legacy, unsequenced logs.
     * Snapshot hydration supplies its authoritative upper bound even when retention or filtered
     * records make the visible sequence values sparse.
     */
    sequenceCursor?: number
    /**
     * The interaction lifecycle rows this transcript was replayed against (#5942). Records never
     * carry a row's later lifecycle, so this is the only place the adoption guard can see whether
     * a card is still awaiting the user (`pending`) or has ended. Empty when the fetch failed or
     * the session has no rows; the two cases are indistinguishable here.
     */
    interactionRows?: SessionInteractionRowStates
}

/** Runtime boundary for watch callbacks and best-effort transcript reads. */
export const isSessionTranscript = (value: unknown): value is SessionTranscript => {
    if (!value || typeof value !== "object") return false
    const candidate = value as Partial<SessionTranscript>
    return (
        Array.isArray(candidate.messages) &&
        typeof candidate.recordCount === "number" &&
        Number.isFinite(candidate.recordCount) &&
        (candidate.sequenceCursor === undefined ||
            (typeof candidate.sequenceCursor === "number" &&
                Number.isFinite(candidate.sequenceCursor)))
    )
}

const sequenceCursorForRecords = (records: {sequence?: number | null}[]): number | undefined => {
    const cursor = records.reduce((latest, record) => Math.max(latest, record.sequence ?? 0), 0)
    return cursor || undefined
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
        await Promise.resolve(store.set(revalidateSessionInteractionsAtom, sessionId)).catch(
            () => undefined,
        )
        // The best-effort lifecycle join must never gate transcript loading.
        const [{records, refreshed}, interactionRowStates] = await Promise.all([
            store.set(fetchSessionRecordsAtom, sessionId),
            store.set(fetchSessionInteractionStatesAtom, sessionId),
        ])
        if (refreshed && onRefreshed) {
            void refreshed
                .then(async (fresh) => {
                    if (!fresh || fresh.length === 0) return
                    await Promise.resolve(
                        store.set(revalidateSessionInteractionsAtom, sessionId),
                    ).catch(() => undefined)
                    const freshInteractionRowStates = await store.set(
                        fetchSessionInteractionStatesAtom,
                        sessionId,
                    )
                    const freshMsgs = transcriptToMessages(fresh, {
                        interactionRowStates: freshInteractionRowStates,
                    })
                    if (freshMsgs && freshMsgs.length > 0) {
                        onRefreshed({
                            messages: freshMsgs,
                            recordCount: fresh.length,
                            sequenceCursor: sequenceCursorForRecords(fresh),
                            interactionRows: freshInteractionRowStates,
                        })
                    }
                })
                // This chain outlives the function, so the try/catch below cannot see it. A
                // failed revalidation keeps whatever the cache already restored; without this
                // it surfaces as an unhandled rejection.
                .catch((err) => {
                    console.warn("[loadSessionMessages] revalidation failed:", err)
                })
        }
        if (!records || records.length === 0) return null
        const messages = transcriptToMessages(records, {interactionRowStates})
        return messages
            ? {
                  messages,
                  recordCount: records.length,
                  sequenceCursor: sequenceCursorForRecords(records),
                  interactionRows: interactionRowStates,
              }
            : null
    } catch (err) {
        console.warn("[loadSessionMessages] hydration fetch failed:", err)
        return null
    }
}
