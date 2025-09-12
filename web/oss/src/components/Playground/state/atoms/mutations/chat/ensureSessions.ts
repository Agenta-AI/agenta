import {atom} from "jotai"

import {
    chatSessionIdsAtom as normChatSessionIdsAtom,
    chatSessionsByIdAtom as normChatSessionsByIdAtom,
    inputRowsByIdAtom as normInputRowsByIdAtom,
} from "@/oss/state/generation/entities"

import {appChatModeAtom} from "../../app"
import {displayedVariantsAtom} from "../../variants"

/**
 * Ensure a chat session exists for every displayed revision.
 * No-op for revisions that already have a session.
 */
export const ensureChatSessionsForDisplayedRevisionsAtom = atom(null, (get, set) => {
    const isChat = get(appChatModeAtom) as boolean
    if (!isChat) return
    const displayedRevIds = (get(displayedVariantsAtom) || []) as string[]

    if (!Array.isArray(displayedRevIds) || displayedRevIds.length === 0) return

    set(normChatSessionsByIdAtom, (prev) => {
        const next = {...(prev as any)} as Record<string, any>
        const baselineRev = displayedRevIds[0]
        const baselineSid = baselineRev ? `session-${baselineRev}` : undefined
        let baselineVars: any[] | undefined = baselineSid
            ? (next[baselineSid]?.variablesByRevision?.[baselineRev] as any[]) || undefined
            : undefined

        // Fallback: derive baseline vars from first normalized input row if session vars missing/empty
        if (!Array.isArray(baselineVars) || baselineVars.length === 0) {
            try {
                const rowsById = get(normInputRowsByIdAtom) as any
                const allRows = Object.values(rowsById || {})
                const normRow = allRows?.[0]
                const allByRev: Record<string, any[]> = normRow?.variablesByRevision || {}
                const nodes = (allByRev?.[baselineRev] || []) as any[]
                if (Array.isArray(nodes) && nodes.length > 0) baselineVars = nodes
            } catch {}
        }

        displayedRevIds.forEach((revId) => {
            const sid = `session-${revId}`
            if (!next[sid]) {
                // Default variables: empty values
                const clonedVars = Array.isArray(baselineVars)
                    ? baselineVars.map((n: any) => ({...structuredClone(n)}))
                    : []
                next[sid] = {
                    id: sid,
                    variablesByRevision: {
                        [revId]: clonedVars,
                    },
                    turnIds: [],
                    meta: {},
                } as any
            }
        })
        return next
    })
    set(normChatSessionIdsAtom, (_prev) => displayedRevIds.map((r) => `session-${r}`))
})
