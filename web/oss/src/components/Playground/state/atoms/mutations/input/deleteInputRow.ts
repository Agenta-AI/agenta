import {atom} from "jotai"

import {
    chatSessionsByIdAtom as normChatSessionsByIdAtom,
    chatTurnsByIdAtom as normChatTurnsByIdAtom,
    inputRowIdsAtom as normInputRowIdsAtom,
    inputRowsByIdAtom as normInputRowsByIdAtom,
    rowIdIndexAtom as normRowIdIndexAtom,
} from "@/oss/state/generation/entities"

import {appChatModeAtom} from "../../app"
import {displayedVariantsAtom} from "../../variants"
import {addEmptyChatTurnSystemMutationAtom} from "../chat/addEmptyTurnSystem"

/**
 * Delete a generation input row (chat or completion mode)
 */
export const deleteGenerationInputRowMutationAtom = atom(null, (get, set, rowId: string) => {
    const isChatVariant = get(appChatModeAtom)

    if (isChatVariant) {
        // CHAT MODE: rowId is a chat turn id
        const turnsById = get(normChatTurnsByIdAtom)
        const turn = turnsById[rowId]
        if (!turn) return
        const sessionId = turn.sessionId

        // Remove turn entity
        set(normChatTurnsByIdAtom, (prev) => {
            const next = {...prev}
            delete next[rowId]
            return next
        })

        // Remove turn reference from its session
        set(normChatSessionsByIdAtom, (prev) => {
            const session = prev[sessionId]
            if (!session) return prev
            const updated = {
                ...session,
                turnIds: (session.turnIds || []).filter((id) => id !== rowId),
            }
            return {...prev, [sessionId]: updated}
        })

        // Update index entries that reference this turn
        set(normRowIdIndexAtom, (prev) => {
            const next = {...prev}
            Object.entries(next).forEach(([rid, entry]) => {
                if (entry?.chatTurnIds?.includes(rowId)) {
                    next[rid] = {
                        ...entry,
                        chatTurnIds: (entry.chatTurnIds || []).filter((id) => id !== rowId),
                    }
                }
            })
            return next
        })

        // After deletion, if there is no trailing empty user input across displayed revisions, append one
        const displayed = (get(displayedVariantsAtom) || []) as string[]
        if (Array.isArray(displayed) && displayed.length > 0) {
            const sessions = get(normChatSessionsByIdAtom) as Record<string, any>
            const turns = get(normChatTurnsByIdAtom) as Record<string, any>
            const hasEmptyTail = (displayed || []).some((revId) => {
                const sid = `session-${revId}`
                const sess = sessions[sid]
                const ids = (sess?.turnIds || []) as string[]
                const lastId = ids[ids.length - 1]
                if (!lastId) return false
                const last = turns[lastId]
                const user = last?.userMessage
                if (!user) return false
                const v = user?.content?.value
                if (typeof v === "string") return v.trim().length === 0
                if (Array.isArray(v)) {
                    try {
                        const textParts = v.filter((p: any) => p?.type?.value === "text")
                        if (textParts.length === 0) return true
                        const isTextEmpty = (p: any) => (p?.text?.value || "").trim().length === 0
                        return textParts.every(isTextEmpty)
                    } catch {
                        return false
                    }
                }
                return false
            })
            if (!hasEmptyTail) {
                // Append a new empty user turn aligned across displayed revisions
                set(addEmptyChatTurnSystemMutationAtom)
            }
        }
        return
    }

    // COMPLETION MODE: remove normalized input row
    set(normInputRowIdsAtom, (prev) => prev.filter((id) => id !== rowId))
    set(normInputRowsByIdAtom, (prev) => {
        const next = {...prev}
        delete next[rowId]
        return next
    })

    // Removed legacy prune: do not mirror normalized variables into generationData.inputs
    set(normRowIdIndexAtom, (prev) => {
        const next = {...prev}
        if (next[rowId]) delete next[rowId]
        return next
    })
})
