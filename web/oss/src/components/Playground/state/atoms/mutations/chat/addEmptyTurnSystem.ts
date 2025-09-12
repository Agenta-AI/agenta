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
 * System variant: does not require UI allow gates; intended for orchestrator-controlled appends.
 */
export const addEmptyChatTurnSystemMutationAtom = atom(null, (get, set) => {
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

    // Create turns aligned across sessions
    const logicalTurnId = `lt-${generateId()}`
    const toInsert: Record<string, any> = {}
    const toUpdateSessions: Record<string, any> = {}
    displayedRevIds.forEach((revId) => {
        const sessionId = `session-${revId}`
        const newTurnId = `turn-${revId}-${logicalTurnId}`

        // Resolve session and previous turn BEFORE building message so we can clone metadata
        const sess = get(normChatSessionsByIdAtom)[sessionId]
        const turnIds = (sess?.turnIds || []) as string[]

        // Derive message metadata per revision (not from baseline)
        const revPrompts = (get(promptsAtomFamily(revId)) || []) as any[]
        const sample = revPrompts.flatMap((p: any) => p?.messages?.value || []).find(Boolean) as any
        const messageMetaId = sample?.__metadata as string | undefined

        // Build a proper message node with revision-specific metadata
        let userMsg: any
        if (messageMetaId) {
            // Prefer schema-driven creation when metadata is available
            userMsg = createMessageFromSchema(getMetadataLazy(messageMetaId) as any, {
                role: "user",
                content: {value: ""},
            })
        }

        if (!userMsg) {
            // Fallback: clone role/content ids and metadata from previous user message in this session if available
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
        }
        if (!userMsg) {
            // Final fallback: minimal node
            userMsg = {
                __id: `user-${logicalTurnId}`,
                role: {__id: `role-${logicalTurnId}`, value: "user"},
                content: {__id: `content-${logicalTurnId}`, value: ""},
            } as any
        }

        // Always append a new empty user turn; orchestrator handles idempotency and gating externally
        toInsert[newTurnId] = {
            id: newTurnId,
            sessionId,
            logicalTurnId,
            userMessage: userMsg,
            assistantMessageByRevision: {[revId]: null},
            meta: {source: "system"},
        }

        const arr = [...turnIds, newTurnId]
        toUpdateSessions[sessionId] = {...sess, turnIds: arr}
    })

    set(normChatTurnsByIdAtom, (prev) => ({...prev, ...toInsert}))
    set(normChatSessionsByIdAtom, (prev) => ({...prev, ...toUpdateSessions}))

    // Update logical index mapping for the new logical turn across all displayed revisions
    set(normLogicalTurnIndexAtom, (prev) => {
        const current = {...prev}
        const entry: Record<string, string> = {}
        displayedRevIds.forEach((revId) => {
            entry[revId] = `turn-${revId}-${logicalTurnId}`
        })
        current[logicalTurnId] = entry
        return current as any
    })
})
