import {useEffect} from "react"

import {
    normalizeTraceId,
    sessionTurnsByTraceAtomFamily,
    sessionTurnsQueryFamily,
    turnFigures,
    type TurnFigures,
} from "@agenta/entities/session"
import {useAtomValue} from "jotai"

/** A turn whose row is missing from a loaded list re-reads it after this long at most. */
const MISSING_ROW_REFETCH_MS = 5_000

/**
 * The tokens, cost and latency stored on a turn's row, matched by the turn's trace id.
 * `undefined` while the row is not loaded or has no usage yet: the footer then falls back to the
 * trace and the streamed usage. A settled turn whose row is not in the list re-reads it once.
 */
export const useTurnRowMetrics = ({
    sessionId,
    traceId,
    settled,
}: {
    sessionId: string
    traceId?: string | null
    settled: boolean
}): TurnFigures | undefined => {
    const query = useAtomValue(sessionTurnsQueryFamily(sessionId))
    const byTrace = useAtomValue(sessionTurnsByTraceAtomFamily(sessionId))
    const key = normalizeTraceId(traceId)
    const row = key ? byTrace.get(key) : undefined
    const missing = settled && Boolean(key) && query.isSuccess && !row

    useEffect(() => {
        if (!missing) return
        if (Date.now() - query.dataUpdatedAt < MISSING_ROW_REFETCH_MS) return
        void query.refetch()
    }, [missing, query])

    return row ? turnFigures(row) : undefined
}
