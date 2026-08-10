import type {SessionTranscript} from "@agenta/chat/assets"
import {shouldAdoptServerTranscript} from "@agenta/entities/session"

/** What the screen renders right now — the local half of the shared adoption rule. */
export interface RenderedTranscript {
    messageCount: number
    /** Records the rendered transcript was built from; `undefined` before the first adoption. */
    watermark: number | undefined
}

/**
 * Should a delivered server transcript replace what the screen renders?
 *
 * The rule itself is the shared one (`shouldAdoptServerTranscript`, which desktop's
 * `useSessionHydration` also calls) — the record log grew past our watermark, and the snapshot
 * isn't shorter than what we show. Only the two inputs mobile has no direct equivalent for are
 * filled in here:
 *   - `busy` is always false: mobile is read-only, it never holds a live `useChat` stream that
 *     could outrank the durable log.
 *   - the watermark is the hook's in-memory one, not desktop's persisted
 *     `agenta:agent-chat:record-counts` — mobile caches no transcript, so it re-syncs on open.
 */
export const shouldAdoptTranscript = (
    transcript: SessionTranscript | null,
    rendered: RenderedTranscript,
): boolean =>
    transcript !== null &&
    shouldAdoptServerTranscript({
        serverRecordCount: transcript.recordCount,
        serverMessageCount: transcript.messages.length,
        localMessageCount: rendered.messageCount,
        watermark: rendered.watermark,
        busy: false,
    })
