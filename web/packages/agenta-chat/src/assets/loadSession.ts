// Canonical since the desktop re-plumb: the OSS copy is deleted and both apps import this.
// Adaptations: none — `fetchSessionRecordsAtom`/`fetchSessionInteractionStatesAtom` already read
// `projectIdAtom` internally from `@agenta/entities/session` (an allowed package dep), so no
// OSS-app-only import is involved and no signature change was needed.
// Re-synced 2026-08-10: interaction rows now provide replay lifecycle and saved outcomes.
import {
    fetchSessionInteractionStatesAtom,
    fetchSessionRecordsAtom,
    revalidateSessionInteractionsAtom,
    revalidateSessionRecordsAtom,
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

/**
 * One read of the record log: the transcript the cache answers with, plus the revalidation
 * flight when that answer was stale (disk-restored or past its window).
 */
const readSessionTranscript = async (
    sessionId: string,
): Promise<{
    transcript: SessionTranscript | null
    refreshed?: Promise<SessionTranscript | null>
}> => {
    const store = getDefaultStore()
    await Promise.resolve(store.set(revalidateSessionInteractionsAtom, sessionId)).catch(
        () => undefined,
    )
    // The best-effort lifecycle join must never gate transcript loading.
    const [{records, refreshed}, interactionRowStates] = await Promise.all([
        store.set(fetchSessionRecordsAtom, sessionId),
        store.set(fetchSessionInteractionStatesAtom, sessionId),
    ])
    const toTranscript = (
        rows: typeof records,
        rowStates: SessionInteractionRowStates,
    ): SessionTranscript | null => {
        if (!rows || rows.length === 0) return null
        const messages = transcriptToMessages(rows, {interactionRowStates: rowStates})
        return messages
            ? {
                  messages,
                  recordCount: rows.length,
                  sequenceCursor: sequenceCursorForRecords(rows),
                  interactionRows: rowStates,
              }
            : null
    }
    return {
        transcript: toTranscript(records, interactionRowStates),
        refreshed: refreshed
            ? refreshed.then(async (fresh) => {
                  if (!fresh || fresh.length === 0) return null
                  await Promise.resolve(
                      store.set(revalidateSessionInteractionsAtom, sessionId),
                  ).catch(() => undefined)
                  const freshRowStates = await store.set(
                      fetchSessionInteractionStatesAtom,
                      sessionId,
                  )
                  return toTranscript(fresh, freshRowStates)
              })
            : undefined,
    }
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
        const {transcript, refreshed} = await readSessionTranscript(sessionId)
        if (refreshed && onRefreshed) {
            void refreshed
                .then((fresh) => {
                    if (fresh) onRefreshed(fresh)
                })
                // This chain outlives the function, so the try/catch below cannot see it. A
                // failed revalidation keeps whatever the cache already restored; without this
                // it surfaces as an unhandled rejection.
                .catch((err) => {
                    console.warn("[loadSessionMessages] revalidation failed:", err)
                })
        }
        return transcript
    } catch (err) {
        console.warn("[loadSessionMessages] hydration fetch failed:", err)
        return null
    }
}

/**
 * A FRESH read of the record log, for a turn that just ended.
 *
 * `loadSessionMessages` answers from the cache inside its stale window and hands the revalidation
 * to a callback, which is right for opening a session and wrong for settling a send: the caller
 * needs the rows the turn just saved, and needs to know when it has them. This marks the cache
 * stale first, delivers the cached transcript at once through `onTranscript` so nothing on screen
 * waits, and resolves only once the refreshed log has been delivered too. Resolves `false` when
 * the log could not be read, so a caller draws no conclusion from it.
 */
export const reloadSessionMessages = async (
    sessionId: string,
    onTranscript: (transcript: SessionTranscript) => void,
): Promise<boolean> => {
    try {
        const store = getDefaultStore()
        store.set(revalidateSessionRecordsAtom, sessionId)
        const {transcript, refreshed} = await readSessionTranscript(sessionId)
        if (transcript) onTranscript(transcript)
        // No flight means the cache had nothing: that read WAS the fresh one.
        if (!refreshed) return transcript !== null
        const fresh = await refreshed
        if (fresh) onTranscript(fresh)
        // Only the fresh read counts. The cached transcript was delivered for the screen, but it
        // predates the turn, so it says nothing about whether the rows landed.
        return fresh !== null
    } catch (err) {
        console.warn("[reloadSessionMessages] records read failed:", err)
        return false
    }
}
