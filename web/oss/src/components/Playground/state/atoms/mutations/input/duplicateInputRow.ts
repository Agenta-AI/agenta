import {atom} from "jotai"

import {generateId} from "@/oss/lib/shared/variant/stringUtils"
import {
    chatSessionsByIdAtom as normChatSessionsByIdAtom,
    chatTurnsByIdAtom as normChatTurnsByIdAtom,
    inputRowIdsAtom as normInputRowIdsAtom,
    inputRowsByIdAtom as normInputRowsByIdAtom,
    rowIdIndexAtom as normRowIdIndexAtom,
    type NormInputRow,
    type NormPropertyNode,
} from "@/oss/state/generation/entities"

import {appChatModeAtom} from "../../app"

/**
 * Duplicate a generation input row (chat or completion mode)
 */
export const duplicateGenerationInputRowMutationAtom = atom(null, (get, set, rowId: string) => {
    const isChatVariant = get(appChatModeAtom)

    if (isChatVariant) {
        // Duplicate a chat turn
        const turnsById = get(normChatTurnsByIdAtom)
        const target = turnsById[rowId]
        if (!target) return
        const sessionId = target.sessionId
        const newTurnId = `turn-${generateId()}`

        const duplicatedTurn = {
            ...structuredClone(target),
            id: newTurnId,
            // Clear assistant message results for all revisions
            assistantMessageByRevision: Object.fromEntries(
                Object.keys(target.assistantMessageByRevision || {}).map((rid) => [rid, null]),
            ),
        }

        set(normChatTurnsByIdAtom, (prev) => ({...prev, [newTurnId]: duplicatedTurn}))
        set(normChatSessionsByIdAtom, (prev) => {
            const session = prev[sessionId]
            if (!session) return prev
            const idx = (session.turnIds || []).indexOf(rowId)
            const newTurnIds = [...(session.turnIds || [])]
            newTurnIds.splice((idx >= 0 ? idx : newTurnIds.length) + 1, 0, newTurnId)
            return {...prev, [sessionId]: {...session, turnIds: newTurnIds}}
        })

        // Update index to insert duplicated turn after the original where applicable
        set(normRowIdIndexAtom, (prev) => {
            const next = {...prev}
            Object.entries(next).forEach(([rid, entry]) => {
                const list = entry?.chatTurnIds || []
                const i = list.indexOf(rowId)
                if (i >= 0) {
                    const updated = [...list]
                    updated.splice(i + 1, 0, newTurnId)
                    next[rid] = {...entry, chatTurnIds: updated}
                }
            })
            return next
        })
        return
    }

    // Duplicate a completion input row
    const rowsById = get(normInputRowsByIdAtom)
    const ids = get(normInputRowIdsAtom)
    const target = rowsById[rowId] as NormInputRow | undefined
    if (!target) return
    const newRowId = `row-${generateId()}`

    const variablesByRevision: Record<string, NormPropertyNode[]> = {}
    Object.entries(target.variablesByRevision || {}).forEach(([revId, nodes]) => {
        // Duplicate should preserve existing values/content
        variablesByRevision[revId] = (nodes || []).map((n) => ({...structuredClone(n)}))
    })

    const newRow: NormInputRow = {
        id: newRowId,
        variablesByRevision,
        responsesByRevision: {},
        meta: {},
    }

    // Insert after original
    const idx = ids.indexOf(rowId)
    set(normInputRowIdsAtom, (prev) => {
        const arr = [...prev]
        arr.splice((idx >= 0 ? idx : arr.length) + 1, 0, newRowId)
        return arr
    })
    set(normInputRowsByIdAtom, (prev) => ({...prev, [newRowId]: newRow}))
    set(normRowIdIndexAtom, (prev) => {
        const latestRev = prev[rowId]?.latestRevisionId
        return {
            ...prev,
            [newRowId]: {latestRevisionId: latestRev},
        }
    })

    // No legacy mirroring needed for completion duplication.
})
