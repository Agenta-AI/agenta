import {useCallback} from "react"

import {useSetAtom} from "jotai"

import {
    triggerWebWorkerTestAtom,
    setLastRunTurnForVariantAtom,
} from "@/oss/components/Playground/state/atoms"

export const resolveSessionTurnId = (
    logicalId: string,
    rev: string,
    logicalMap: Record<string, string> | undefined,
    baselineRev: string | undefined,
    sessionTurnId: string | undefined,
    turnId: string,
    turnsById: Record<string, any>,
    sessionsById: Record<string, any>,
): string | undefined => {
    // 1) direct logical index map
    let sid = (logicalMap as any)?.[rev]
    // 2) baseline fallback
    if (!sid && baselineRev && rev === baselineRev) sid = sessionTurnId || turnId
    // 3) convention fallback
    if (!sid) {
        const candidate = `turn-${rev}-${logicalId}`
        if ((turnsById as any)[candidate]) sid = candidate
    }
    // 4) scan session for matching logicalTurnId
    if (!sid) {
        const sessId = `session-${rev}`
        const sess = (sessionsById as any)[sessId]
        if (sess && Array.isArray(sess.turnIds)) {
            const found = (sess.turnIds as string[]).find((tid) => {
                const t = (turnsById as any)[tid]
                return t?.logicalTurnId === logicalId
            })
            if (found) sid = found
        }
    }
    return sid
}

export const useRunControls = () => {
    const setLastRunTurn = useSetAtom(setLastRunTurnForVariantAtom)
    const triggerTest = useSetAtom(triggerWebWorkerTestAtom)

    const runForRevisions = useCallback(
        (
            logicalId: string,
            revisionIds: string[],
            logicalMap: Record<string, string> | undefined,
            baselineRev: string | undefined,
            sessionTurnId: string | undefined,
            turnId: string,
            turnsById: Record<string, any>,
            sessionsById: Record<string, any>,
        ) => {
            revisionIds.forEach((vid) => {
                const sid = resolveSessionTurnId(
                    logicalId,
                    vid,
                    logicalMap,
                    baselineRev,
                    sessionTurnId,
                    turnId,
                    turnsById,
                    sessionsById,
                )
                if (!sid) return
                setLastRunTurn({logicalId, revisionId: vid, rowId: sid} as any)
                triggerTest({rowId: sid, variantId: vid} as any)
            })
        },
        [setLastRunTurn, triggerTest],
    )

    return {runForRevisions}
}

export default useRunControls
