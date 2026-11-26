import {
    normalizeTraceId,
    sessionTurnsByTraceAtomFamily,
    sessionTurnsPendingAtomFamily,
    turnFigures,
    type TurnFigures,
} from "@agenta/entities/session"
import {useAtomValue} from "jotai"

export interface SessionTurnFooter {
    /** The figures stored on the session turn; undefined when it knows none (or there is none). */
    figures?: TurnFigures
    /** The start of the session turn, for the footer's time and the activity clock. */
    startedAt?: string | null
    /** The session's turns are still loading. */
    pending: boolean
}

/**
 * The session turn of a chat message, matched by trace id: the assistant message's own trace, or
 * for a user message the trace of the turn it started. The session's one turns query decides when
 * to re-read.
 */
export const useSessionTurnFooter = ({
    sessionId,
    traceId,
}: {
    sessionId: string
    traceId?: string | null
}): SessionTurnFooter => {
    const pending = useAtomValue(sessionTurnsPendingAtomFamily(sessionId))
    const byTrace = useAtomValue(sessionTurnsByTraceAtomFamily(sessionId))
    const key = normalizeTraceId(traceId)
    const sessionTurn = key ? byTrace.get(key) : undefined
    return {
        figures: sessionTurn ? turnFigures(sessionTurn) : undefined,
        startedAt: sessionTurn?.start_time ?? null,
        pending,
    }
}
