import {
    normalizeTraceId,
    sessionTurnsByTraceAtomFamily,
    sessionTurnsQueryFamily,
    turnFigures,
    type TurnFigures,
} from "@agenta/entities/session"
import {useAtomValue} from "jotai"

export interface TurnRowFooter {
    /** The figures stored on the turn row; undefined when it has no usage (or no row yet). */
    figures?: TurnFigures
    /** The start of the turn row, for the footer's time. */
    startedAt?: string | null
    /** The session's turn rows are still loading. */
    pending: boolean
}

/**
 * The footer's turn row, matched by trace id: the assistant turn's own trace, or for a user turn
 * the trace of the turn it started. The session's one turns query decides when to re-read.
 */
export const useTurnRowFooter = ({
    sessionId,
    traceId,
}: {
    sessionId: string
    traceId?: string | null
}): TurnRowFooter => {
    const query = useAtomValue(sessionTurnsQueryFamily(sessionId))
    const byTrace = useAtomValue(sessionTurnsByTraceAtomFamily(sessionId))
    const key = normalizeTraceId(traceId)
    const row = key ? byTrace.get(key) : undefined
    return {
        figures: row ? turnFigures(row) : undefined,
        startedAt: row?.start_time ?? null,
        pending: query.isLoading,
    }
}
