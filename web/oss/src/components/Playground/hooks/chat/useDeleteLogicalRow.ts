import {useCallback} from "react"

import {useAtomValue, useSetAtom} from "jotai"

import {displayedVariantsAtom} from "@/oss/components/Playground/state/atoms"
import {
    normalizeComparisonChatTurnsMutationAtom,
    pruneLogicalTurnIndexForDisplayedVariantsMutationAtom,
} from "@/oss/components/Playground/state/atoms/generationMutations"
import {
    chatSessionsByIdAtom,
    chatTurnsByIdAtom,
    logicalTurnIndexAtom,
    runStatusByRowRevisionAtom,
} from "@/oss/state/generation/entities"

/**
 * Return deletion helpers for chat rows.
 * - deleteWholeRow: deletes a logical row across displayed revisions (comparison view use-case)
 * - onDeleteRow: deletes a logical row across displayed revisions starting from a resolvedTurnId (single view use-case)
 */
const useDeleteLogicalRow = () => {
    const setSessions = useSetAtom(chatSessionsByIdAtom)
    const setTurns = useSetAtom(chatTurnsByIdAtom)
    const setLogicalIndex = useSetAtom(logicalTurnIndexAtom)
    const setRunStatusMap = useSetAtom(runStatusByRowRevisionAtom)
    const normalizeTurns = useSetAtom(normalizeComparisonChatTurnsMutationAtom)
    const pruneLogicalIndex = useSetAtom(pruneLogicalTurnIndexForDisplayedVariantsMutationAtom)
    const turnsById = useAtomValue(chatTurnsByIdAtom)
    const logicalIndex = useAtomValue(logicalTurnIndexAtom) as Record<
        string,
        Record<string, string>
    >
    const displayedVariantIds = useAtomValue(displayedVariantsAtom)

    const deleteByLogicalId = useCallback(
        (logicalId: string, baselineSid?: string | null) => {
            const map = (logicalIndex?.[logicalId] || {}) as Record<string, string>
            const uniqueSids = Array.from(
                new Set([...(Object.values(map) || []), baselineSid].filter(Boolean) as string[]),
            )

            // Remove turns from their sessions using turnsById to resolve sessionId
            setSessions((prev) => {
                const next = {...prev}
                for (const sid of uniqueSids) {
                    const sessId = (turnsById as any)?.[sid]?.sessionId
                    if (!sessId) continue
                    const sess = next?.[sessId]
                    if (!sess || !Array.isArray(sess.turnIds)) continue
                    next[sessId] = {
                        ...sess,
                        turnIds: (sess.turnIds as string[]).filter((id: string) => id !== sid),
                    }
                }
                return next
            })

            // Delete turns
            setTurns((prev) => {
                const next = {...prev}
                for (const sid of uniqueSids) delete next[sid]
                return next
            })

            // Remove logical index entry for this row
            setLogicalIndex((prev: any) => {
                const next = {...(prev || {})}
                delete next[logicalId]
                return next
            })

            // Clear run status entries for all displayed variants for this logical row
            setRunStatusMap?.((prev: any) => {
                const next = {...(prev || {})}
                const vids = displayedVariantIds || []
                for (const sid of uniqueSids) {
                    for (const vid of vids) {
                        const key = `${sid}:${vid}`
                        if (key in next) delete next[key]
                    }
                }
                return next
            })

            // After deletion, bring structure back to a stable state.
            // Do not auto-append a trailing input here; leave it to loader/orchestrator logic
            // to decide when a tail is actually needed. This avoids adding an empty row on every delete.
            normalizeTurns()
            pruneLogicalIndex()
        },
        [
            displayedVariantIds,
            logicalIndex,
            normalizeTurns,
            pruneLogicalIndex,
            setLogicalIndex,
            setRunStatusMap,
            setSessions,
            setTurns,
            turnsById,
        ],
    )

    // comparison view: delete whole logical row
    const useDeleteWholeRow = (logicalId: string, baselineSessionTurnId?: string | null) => {
        return useCallback(
            () => deleteByLogicalId(logicalId, baselineSessionTurnId),
            [deleteByLogicalId, logicalId, baselineSessionTurnId],
        )
    }

    // single view: delete row based on resolvedTurnId (compute logicalId from turnsById)
    const useDeleteRowFromResolvedTurn = (resolvedTurnId: string) => {
        const logicalId = (turnsById as any)?.[resolvedTurnId]?.logicalTurnId || resolvedTurnId
        return useCallback(() => deleteByLogicalId(logicalId), [deleteByLogicalId, logicalId])
    }

    return {useDeleteWholeRow, useDeleteRowFromResolvedTurn}
}

export default useDeleteLogicalRow
