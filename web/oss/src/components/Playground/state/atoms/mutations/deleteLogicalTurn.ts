import {atom} from "jotai"

import {
    chatSessionsByIdAtom as normChatSessionsByIdAtom,
    chatTurnsByIdAtom as normChatTurnsByIdAtom,
    logicalTurnIndexAtom as normLogicalTurnIndexAtom,
    runStatusByRowRevisionAtom,
} from "@/oss/state/generation/entities"

import {displayedVariantsAtom} from "../variants"

/**
 * Delete an entire logical chat row across all revisions (displayed variants) in chat mode.
 * payload.logicalId must be the logical turn id. Optionally pass baselineSessionTurnId to include it.
 */
export const deleteLogicalTurnAcrossRevisionsMutationAtom = atom(
    null,
    (get, set, payload: {logicalId: string; baselineSessionTurnId?: string | null}) => {
        const {logicalId, baselineSessionTurnId} = payload || ({} as any)
        if (!logicalId) return

        // Map of revisionId -> sessionTurnId for this logical row
        const index = (get(normLogicalTurnIndexAtom) || {}) as Record<
            string,
            Record<string, string>
        >
        const map = (index || {})[logicalId] || {}

        // Build unique list of session turn ids to remove
        const baselineSid = baselineSessionTurnId || undefined
        const sids = [...Object.values(map || {}), baselineSid].filter(Boolean) as string[]
        const uniqueSids = Array.from(new Set(sids))

        // Remove turns from their sessions using turnsById to resolve sessionId
        const turnsById = (get(normChatTurnsByIdAtom) || {}) as Record<string, any>
        set(normChatSessionsByIdAtom, (prev) => {
            const next = {...prev}
            for (const sid of uniqueSids) {
                const sessId = turnsById?.[sid]?.sessionId
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
        set(normChatTurnsByIdAtom, (prev) => {
            const next = {...prev}
            for (const sid of uniqueSids) delete next[sid]
            return next
        })

        // Remove logical index entry for this row
        set(normLogicalTurnIndexAtom, (prev: any) => {
            const next = {...(prev || {})}
            delete next[logicalId]
            return next
        })

        // Clear run status entries for all displayed variants for this logical row
        const vids = (get(displayedVariantsAtom) || []) as string[]
        set(runStatusByRowRevisionAtom, (prev: any) => {
            const next = {...(prev || {})}
            for (const sid of uniqueSids) {
                for (const vid of vids) {
                    const key = `${sid}:${vid}`
                    if (key in next) delete next[key]
                }
            }
            return next
        })
    },
)
