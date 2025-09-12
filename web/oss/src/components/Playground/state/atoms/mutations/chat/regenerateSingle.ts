import {atom} from "jotai"

import {
    chatSessionsByIdAtom as normChatSessionsByIdAtom,
    chatTurnsByIdAtom as normChatTurnsByIdAtom,
    logicalTurnIndexAtom as normLogicalTurnIndexAtom,
} from "@/oss/state/generation/entities"

import {displayedVariantsAtom} from "../../variants"

/**
 * Regenerate single-mode chat state using only the active revision's messages.
 * Keeps only the session/turns for the displayed revision and prunes others from
 * chat sessions, turns, and logicalTurnIndex.
 */
export const regenerateSingleModeChatFromActiveRevisionAtom = atom(null, (get, set) => {
    const displayed = (get(displayedVariantsAtom) || []) as string[]
    if (!Array.isArray(displayed) || displayed.length !== 1) return
    const activeRev = displayed[0]
    const targetSessionId = `session-${activeRev}`

    const sessions = (get(normChatSessionsByIdAtom) || {}) as Record<string, any>
    const turns = (get(normChatTurnsByIdAtom) || {}) as Record<string, any>
    const logical = (get(normLogicalTurnIndexAtom) || {}) as Record<string, Record<string, string>>

    const session = sessions[targetSessionId]
    if (!session) return

    const keptTurnIds = (session.turnIds || []).filter(Boolean)
    const keptTurns: Record<string, any> = {}
    keptTurnIds.forEach((tid: string) => {
        const t = turns[tid]
        if (t) keptTurns[tid] = t
    })

    const nextSessions = {
        [targetSessionId]: {...session, turnIds: keptTurnIds},
    } as Record<string, any>

    // Prune logical index to only include active revision mapping to kept turns
    const nextLogical: Record<string, Record<string, string>> = {}
    Object.entries(logical).forEach(([logicalId, map]) => {
        const sid = (map || {})[activeRev]
        if (sid && keptTurns[sid]) {
            nextLogical[logicalId] = {[activeRev]: sid}
        } else {
            // drop this logical id entirely if it has no kept turn for active rev
        }
    })

    set(normChatSessionsByIdAtom, nextSessions)
    set(normChatTurnsByIdAtom, (_prev) => {
        // Only keep keptTurns + drop others
        return {...keptTurns}
    })
    set(normLogicalTurnIndexAtom, nextLogical as any)
})
