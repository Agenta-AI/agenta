import {atom} from "jotai"

import {
    chatSessionsByIdAtom as normChatSessionsByIdAtom,
    chatTurnsByIdAtom as normChatTurnsByIdAtom,
    logicalTurnIndexAtom as normLogicalTurnIndexAtom,
} from "@/oss/state/generation/entities"

/**
 * Prune only EMPTY next turns (for a specific revision) after a target logical turn.
 * A turn is considered empty for that revision if:
 * - userMessage.content.value is empty (string empty or array length 0), AND
 * - assistantMessageByRevision[revisionId] is null/undefined
 * This preserves meaningful future rows while cleaning up stray empties.
 */
export const pruneEmptyNextTurnsForRevisionMutationAtom = atom(
    null,
    (get, set, payload: {logicalId: string; revisionId: string}) => {
        const {logicalId, revisionId} = payload || ({} as any)
        if (!logicalId || !revisionId) return

        const index = (get(normLogicalTurnIndexAtom) || {}) as Record<
            string,
            Record<string, string>
        >
        const map = (index || {})[logicalId] || {}
        const anchorTurnId = map[revisionId]
        if (!anchorTurnId) return

        const turns = (get(normChatTurnsByIdAtom) || {}) as Record<string, any>
        const sessions = (get(normChatSessionsByIdAtom) || {}) as Record<string, any>
        const anchor = turns[anchorTurnId]
        if (!anchor) return
        const sessionId = anchor.sessionId
        const session = sessions[sessionId]
        if (!session) return

        const turnIds: string[] = Array.isArray(session.turnIds) ? session.turnIds : []
        const startIdx = turnIds.indexOf(anchorTurnId)
        if (startIdx < 0) return

        const toRemove: string[] = []
        for (let i = startIdx + 1; i < turnIds.length; i++) {
            const tid = turnIds[i]
            const t = turns[tid]
            if (!t || t.sessionId !== sessionId) continue
            const val = t?.userMessage?.content?.value
            const userEmpty = Array.isArray(val)
                ? val.length === 0
                : typeof val === "string"
                  ? val.trim().length === 0
                  : true
            const assist = (t?.assistantMessageByRevision || {})[revisionId]
            const isEmptyForRev = userEmpty && assist == null
            if (isEmptyForRev) toRemove.push(tid)
        }

        if (toRemove.length === 0) return

        // Delete removed turns
        set(normChatTurnsByIdAtom, (prev) => {
            const next = {...prev}
            toRemove.forEach((tid) => delete next[tid])
            return next
        })

        // Update the session's turnIds
        set(normChatSessionsByIdAtom, (prev) => {
            const s = prev[sessionId]
            if (!s) return prev
            return {
                ...prev,
                [sessionId]: {
                    ...s,
                    turnIds: (s.turnIds || []).filter((id: string) => !toRemove.includes(id)),
                },
            }
        })

        // Remove logicalTurnIndex mappings for those removed turns for this revision
        set(normLogicalTurnIndexAtom, (prev) => {
            const out: Record<string, Record<string, string>> = {}
            Object.entries(prev || {}).forEach(([lid, m]) => {
                const current: Record<string, string> = {...(m || {})}
                // If current[revisionId] points to a removed tid, drop that mapping
                if (current[revisionId] && toRemove.includes(current[revisionId])) {
                    delete current[revisionId]
                }
                if (Object.keys(current).length > 0) out[lid] = current
            })
            return out as any
        })
    },
)
