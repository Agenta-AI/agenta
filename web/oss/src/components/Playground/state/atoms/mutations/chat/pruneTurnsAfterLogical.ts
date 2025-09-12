import {atom} from "jotai"

import {
    chatSessionsByIdAtom as normChatSessionsByIdAtom,
    chatTurnsByIdAtom as normChatTurnsByIdAtom,
    logicalTurnIndexAtom as normLogicalTurnIndexAtom,
} from "@/oss/state/generation/entities"

/**
 * Prune (delete) all subsequent chat turns after the specified logical turn id
 * across all displayed revisions. This keeps the history linear when re-running
 * a middle row in comparison mode.
 */
export const pruneTurnsAfterLogicalIdMutationAtom = atom(null, (get, set, logicalId: string) => {
    const sessions = (get(normChatSessionsByIdAtom) || {}) as Record<string, any>
    const turns = (get(normChatTurnsByIdAtom) || {}) as Record<string, any>
    const logical = (get(normLogicalTurnIndexAtom) || {}) as Record<string, Record<string, string>>

    const map = logical?.[logicalId] || {}
    const removedTurnIds = new Set<string>()
    const keptSessions: Record<string, any> = {}

    Object.values(map).forEach((sid) => {
        const turn = turns[sid]
        if (!turn) return
        const sessionId = turn.sessionId
        const session = sessions[sessionId]
        if (!session) return
        const ids = (session.turnIds || []) as string[]
        const idx = ids.indexOf(sid)
        if (idx < 0) return
        const toKeep = ids.slice(0, idx + 1)
        const toDrop = ids.slice(idx + 1)
        toDrop.forEach((tid) => removedTurnIds.add(tid))
        keptSessions[sessionId] = {...session, turnIds: toKeep}
    })

    if (removedTurnIds.size === 0) return

    set(normChatTurnsByIdAtom, (prev) => {
        const next = {...prev}
        removedTurnIds.forEach((tid) => delete next[tid])
        return next
    })

    set(normChatSessionsByIdAtom, (prev) => ({...prev, ...keptSessions}))

    set(normLogicalTurnIndexAtom, (prev) => {
        const out: Record<string, Record<string, string>> = {}
        Object.entries(prev || {}).forEach(([lid, m]) => {
            const filtered: Record<string, string> = {}
            Object.entries(m || {}).forEach(([revId, sid]) => {
                if (!removedTurnIds.has(sid)) filtered[revId] = sid
            })
            if (Object.keys(filtered).length > 0) out[lid] = filtered
        })
        // Debug: summarize results per kept session

        return out as any
    })
})
