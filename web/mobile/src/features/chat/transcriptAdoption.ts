import {isSessionTranscript, type SessionTranscript} from "@agenta/chat/assets"
import {shouldAdoptServerTranscript} from "@agenta/entities/session"

/** What the screen renders right now — the local half of the shared adoption rule. */
export interface RenderedTranscript {
    messageCount: number
    /** Rows the rendered transcript was built from; used only for legacy, unsequenced logs. */
    recordCount: number | undefined
    /** Highest durable sequence the rendered transcript covers. */
    sequenceCursor: number | undefined
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
export const shouldAdoptTranscript = (transcript: unknown, rendered: RenderedTranscript): boolean =>
    isSessionTranscript(transcript) &&
    shouldAdoptServerTranscript({
        serverRecordCount: transcript.sequenceCursor ?? transcript.recordCount,
        serverMessageCount: transcript.messages.length,
        localMessageCount: rendered.messageCount,
        watermark:
            transcript.sequenceCursor === undefined
                ? rendered.recordCount
                : rendered.sequenceCursor,
        busy: false,
    })

/** Resolve one watch-triggered read without letting transport failure reach React. */
export const adoptTranscriptRead = async (
    read: () => Promise<unknown>,
    adopt: (transcript: SessionTranscript) => boolean,
): Promise<boolean> => {
    try {
        const transcript = await read()
        return isSessionTranscript(transcript) ? adopt(transcript) : false
    } catch {
        return false
    }
}
