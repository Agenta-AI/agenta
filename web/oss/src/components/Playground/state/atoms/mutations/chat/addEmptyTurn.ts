import {atom} from "jotai"

import {createMessageFromSchema} from "@/oss/components/Playground/hooks/usePlayground/assets/messageHelpers"
import {getMetadataLazy} from "@/oss/lib/hooks/useStatelessVariants/state"
import {generateId} from "@/oss/lib/shared/variant/stringUtils"
import {
    chatSessionIdsAtom as normChatSessionIdsAtom,
    chatSessionsByIdAtom as normChatSessionsByIdAtom,
    chatTurnsByIdAtom as normChatTurnsByIdAtom,
    logicalTurnIndexAtom as normLogicalTurnIndexAtom,
} from "@/oss/state/generation/entities"
import {promptsAtomFamily} from "@/oss/state/newPlayground/core/prompts"

import {appChatModeAtom} from "../../app"
import {displayedVariantsAtom, displayedVariantsVariablesAtom} from "../../variants"

/**
 * Append an empty user turn at the end of all chat sessions (one per displayed revision).
 */
export const addEmptyChatTurnMutationAtom = atom(null, (get, set) => {
    const isChatVariant = get(appChatModeAtom)
    if (!isChatVariant) return

    const displayedRevIds = (get(displayedVariantsAtom) || []) as string[]
    const allVariables = (get(displayedVariantsVariablesAtom) || []) as string[]

    // Ensure sessions exist
    set(normChatSessionsByIdAtom, (prev) => {
        const next = {...prev}
        displayedRevIds.forEach((revId) => {
            const sid = `session-${revId}`
            if (!next[sid]) {
                next[sid] = {
                    id: sid,
                    variablesByRevision: {
                        [revId]: allVariables.map((v) => ({
                            __id: generateId(),
                            key: v,
                            value: "",
                            content: {value: ""},
                        })),
                    },
                    turnIds: [],
                    meta: {},
                } as any
            }
        })
        return next
    })
    set(normChatSessionIdsAtom, (_prev) => displayedRevIds.map((r) => `session-${r}`))

    // Determine if any displayed session already has an empty user tail; if so, reuse that logical turn
    const sessions = get(normChatSessionsByIdAtom) as Record<string, any>
    const turns = get(normChatTurnsByIdAtom) as Record<string, any>
    const emptyTailLogicalId: string | null = (() => {
        for (const revId of displayedRevIds) {
            const sid = `session-${revId}`
            const sess = sessions[sid]
            const ids = (sess?.turnIds || []) as string[]
            if (!ids.length) continue
            const last = turns[ids[ids.length - 1]]
            if (!last) continue
            const user = last?.userMessage
            const v = user?.content?.value
            const isEmpty =
                (typeof v === "string" && v.trim().length === 0) ||
                (Array.isArray(v) && v.length === 0)
            if (isEmpty && last?.logicalTurnId) return String(last.logicalTurnId)
        }
        return null
    })()

    const logicalTurnId = emptyTailLogicalId || `lt-${generateId()}`
    const toInsert: Record<string, any> = {}
    const toUpdateSessions: Record<string, any> = {}
    const revsNeedingAppend = displayedRevIds.filter((revId) => {
        const sid = `session-${revId}`
        const sess = sessions[sid]
        const ids = (sess?.turnIds || []) as string[]
        if (!ids.length) return true
        const last = turns[ids[ids.length - 1]]
        return !last || last.logicalTurnId !== logicalTurnId
    })

    // If all displayed already have the empty tail logical turn, do nothing
    if (revsNeedingAppend.length === 0 && emptyTailLogicalId) return

    // Create turns for required revisions (either aligning to existing logical turn or creating new one)
    revsNeedingAppend.forEach((revId) => {
        const sessionId = `session-${revId}`
        const newTurnId = `turn-${revId}-${logicalTurnId}`

        // Derive message metadata per revision (not from baseline)
        const revPrompts = (get(promptsAtomFamily(revId)) || []) as any[]
        const sample = revPrompts.flatMap((p: any) => p?.messages?.value || []).find(Boolean) as any
        const messageMetaId = sample?.__metadata as string | undefined

        // Resolve session and previous turn
        const sess = get(normChatSessionsByIdAtom)[sessionId]
        const turnIds = (sess?.turnIds || []) as string[]

        // Build a proper message node with revision-specific metadata
        let userMsg: any
        if (messageMetaId) {
            userMsg = createMessageFromSchema(getMetadataLazy(messageMetaId) as any, {
                role: "user",
                content: {value: ""},
            })
        }
        if (!userMsg) {
            // Try to clone from previous user message in this session
            try {
                const prevTurnId = turnIds[turnIds.length - 1]
                const prev = prevTurnId ? get(normChatTurnsByIdAtom)[prevTurnId] : null
                const prevUser = prev?.userMessage
                if (prevUser) {
                    userMsg = {
                        __id: prevUser.__id || `user-${logicalTurnId}`,
                        role: {
                            __id: prevUser?.role?.__id || `role-${logicalTurnId}`,
                            value: "user",
                            ...(prevUser?.role?.__metadata
                                ? {__metadata: prevUser.role.__metadata}
                                : {}),
                        },
                        content: {
                            __id: prevUser?.content?.__id || `content-${logicalTurnId}`,
                            value: "",
                            ...(prevUser?.content?.__metadata
                                ? {__metadata: prevUser.content.__metadata}
                                : {}),
                        },
                        ...(prevUser?.__metadata ? {__metadata: prevUser.__metadata} : {}),
                    } as any
                }
            } catch {}
        }
        if (!userMsg) {
            userMsg = {
                __id: `user-${logicalTurnId}`,
                role: {__id: `role-${logicalTurnId}`, value: "user"},
                content: {__id: `content-${logicalTurnId}`, value: ""},
            } as any
        }

        toInsert[newTurnId] = {
            id: newTurnId,
            sessionId,
            logicalTurnId,
            userMessage: userMsg,
            assistantMessageByRevision: {[revId]: null},
            meta: {},
        }

        const arr = [...turnIds, newTurnId]
        toUpdateSessions[sessionId] = {...sess, turnIds: arr}
    })

    if (Object.keys(toInsert).length) {
        set(normChatTurnsByIdAtom, (prev) => ({...prev, ...toInsert}))
    }
    if (Object.keys(toUpdateSessions).length) {
        set(normChatSessionsByIdAtom, (prev) => ({...prev, ...toUpdateSessions}))
    }
    // Update logical index mapping for the logical turn used/created
    set(normLogicalTurnIndexAtom, (prev) => {
        const current = {...prev}
        const entry: Record<string, string> = {...(current[logicalTurnId] || {})}
        displayedRevIds.forEach((revId) => {
            const tid = `turn-${revId}-${logicalTurnId}`
            // Only set mapping if this session actually has the turn (exists or just appended)
            const sid = `session-${revId}`
            const sess = (toUpdateSessions[sid] as any) || (sessions as any)[sid]
            const hasTurn = (sess?.turnIds || []).includes(tid)
            if (hasTurn) entry[revId] = tid
        })
        current[logicalTurnId] = entry
        return current as any
    })
    // UI append completes without needing gate resets
})
