import {useMemo} from "react"

/**
 * Resolve correct session turn id for a given logical turn and revision.
 * - Uses logicalTurnIndex mapping
 * - Falls back to `turn-${rev}-${logicalId}`
 * - Falls back to scanning `session-${rev}` for a turn with matching logicalTurnId
 * - If turnIdIsLogical is false, also allows returning the baseline turnId
 */
export interface ResolvedTurnArgs {
    turnId: string
    effectiveRevisionId: string
    logicalIndex?: Record<string, Record<string, string>> | null
    sessionsById?: Record<string, any> | null
    turnsById?: Record<string, any> | null
    baselineRev?: string
    turnIdIsLogical?: boolean
}

export const useResolvedTurnId = ({
    turnId,
    effectiveRevisionId,
    logicalIndex,
    sessionsById,
    turnsById,
    baselineRev,
    turnIdIsLogical = false,
}: ResolvedTurnArgs) => {
    return useMemo(() => {
        try {
            const logicalId = turnId
            const map = logicalId ? logicalIndex?.[logicalId] || {} : {}
            const rev = effectiveRevisionId
            let sid = (map as any)[rev]

            if (!sid && rev) {
                const candidate = logicalId ? `turn-${rev}-${logicalId}` : undefined
                if (candidate && (turnsById as any)?.[candidate]) sid = candidate
            }

            if (!sid && baselineRev && rev === baselineRev && !turnIdIsLogical) sid = turnId

            if (!sid) {
                const sessId = rev ? `session-${rev}` : undefined
                const session = sessId ? (sessionsById as any)?.[sessId] : undefined
                const found = (session?.turnIds || []).find((tid: string) => {
                    const tt = (turnsById as any)?.[tid]
                    return tt?.logicalTurnId === logicalId
                })
                if (found) sid = found
            }

            return sid || turnId
        } catch {
            return turnId
        }
    }, [
        turnId,
        effectiveRevisionId,
        logicalIndex,
        sessionsById,
        turnsById,
        baselineRev,
        turnIdIsLogical,
    ])
}

export default useResolvedTurnId
