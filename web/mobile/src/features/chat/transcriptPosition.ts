/**
 * Where the reader was in a session's transcript, kept per session id so a remount (a move between
 * the session page and an agent page) puts the reader back (design D6). Kept in memory for the
 * page's lifetime and never cleared: it is two numbers per visited session.
 */
export interface TranscriptPosition {
    /** Where the transcript was scrolled to, or null when the reader was at the latest message. */
    scrollTop: number | null
    /** The first rendered turn: the older turns the reader had loaded are rendered again. */
    windowStart: number | null
}

const positionBySession = new Map<string, TranscriptPosition>()

export const readTranscriptPosition = (sessionId: string): TranscriptPosition | undefined =>
    positionBySession.get(sessionId)

export const writeTranscriptPosition = (sessionId: string, patch: Partial<TranscriptPosition>) => {
    positionBySession.set(sessionId, {
        scrollTop: null,
        windowStart: null,
        ...positionBySession.get(sessionId),
        ...patch,
    })
}
