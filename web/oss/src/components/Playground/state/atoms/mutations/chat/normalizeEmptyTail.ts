import {atom} from "jotai"

import {createMessageFromSchema} from "@/oss/components/Playground/hooks/usePlayground/assets/messageHelpers"
import {getMetadataLazy} from "@/oss/lib/hooks/useStatelessVariants/state"
import {
    chatSessionsByIdAtom as normChatSessionsByIdAtom,
    chatTurnsByIdAtom as normChatTurnsByIdAtom,
    logicalTurnIndexAtom as normLogicalTurnIndexAtom,
} from "@/oss/state/generation/entities"
import {promptsAtomFamily} from "@/oss/state/newPlayground/core/prompts"

import {displayedVariantsAtom} from "../../variants"

/**
 * Normalize any existing empty-tail user messages for displayed revisions so they have correct
 * role/content ids and metadata. This is useful when transitioning from single -> comparison where
 * a previously appended empty row may have been created without schema metadata.
 */
export const normalizeEmptyTailMessageShapeAtom = atom(null, (get, set) => {
    const displayed = (get(displayedVariantsAtom) || []) as string[]
    if (!Array.isArray(displayed) || displayed.length === 0) return

    const sessions = get(normChatSessionsByIdAtom) as Record<string, any>
    const turns = get(normChatTurnsByIdAtom) as Record<string, any>
    const logicalIndex = get(normLogicalTurnIndexAtom) as Record<string, Record<string, string>>

    // Helper to build a user message from a schema id
    const fromSchema = (metaId: string | undefined) => {
        if (!metaId) return null
        try {
            return createMessageFromSchema(getMetadataLazy(metaId) as any, {
                role: "user",
                content: {value: ""},
            })
        } catch {
            return null
        }
    }

    const toPatch: Record<string, any> = {}

    // For each displayed revision, examine tail; if empty user value but missing stable ids/metadata,
    // try to clone from previous in same session; else from sibling revision at the same logical turn.
    displayed.forEach((revId) => {
        const sid = `session-${revId}`
        const sess = sessions[sid]
        const ids = (sess?.turnIds || []) as string[]
        if (!ids.length) return
        const lastId = ids[ids.length - 1]
        const last = turns[lastId]
        if (!last) return
        const user = last?.userMessage
        const val = user?.content?.value
        const isEmpty =
            (typeof val === "string" && val.trim().length === 0) ||
            (Array.isArray(val) && val.length === 0)
        if (!isEmpty) return

        // If already has metadata ids, skip
        const hasStable = Boolean(user?.role?.__id) && Boolean(user?.content?.__id)
        if (hasStable) return

        // 1) Try previous turn in same session
        let candidate: any = null
        const prevId = ids.length > 1 ? ids[ids.length - 2] : null
        const prev = prevId ? turns[prevId] : null
        const prevUser = prev?.userMessage
        if (prevUser) candidate = prevUser

        // 2) Try sibling revision at the same logical turn
        if (!candidate) {
            // Find the logical id for this last turn (via its logicalTurnId), and map to sibling session turn
            const logicalId = last?.logicalTurnId as string | undefined
            if (logicalId) {
                const mapping = (logicalIndex?.[logicalId] || {}) as Record<string, string>
                // prefer sibling different than current revId
                const sibTurnId = Object.entries(mapping).find(([rid]) => rid !== revId)?.[1]
                const sib = sibTurnId ? turns[sibTurnId] : null
                candidate = sib?.userMessage || null
                // If sibling user lacks metadata, attempt to synthesize from sibling prompts schema
                if (candidate && !candidate.__metadata) {
                    const sibRevId = Object.keys(mapping).find((rid) => rid !== revId)
                    if (sibRevId) {
                        const revPrompts = (get(promptsAtomFamily(sibRevId)) || []) as any[]
                        const sample = revPrompts
                            .flatMap((p: any) => p?.messages?.value || [])
                            .find(Boolean) as any
                        const metaId = sample?.__metadata as string | undefined
                        const fromSibSchema = metaId ? fromSchema(metaId) : null
                        if (fromSibSchema) candidate = fromSibSchema
                    }
                }
            }
        }

        // 3) Try schema from candidate
        let replacement: any = null
        if (candidate?.__metadata) {
            replacement = fromSchema(candidate.__metadata)
        }
        // 4) Clone ids/metadata from candidate
        if (!replacement && candidate) {
            replacement = {
                __id: candidate.__id || user?.__id,
                role: {
                    __id: candidate?.role?.__id || user?.role?.__id,
                    value: "user",
                    ...(candidate?.role?.__metadata ? {__metadata: candidate.role.__metadata} : {}),
                },
                content: {
                    __id: candidate?.content?.__id || user?.content?.__id,
                    value: "",
                    ...(candidate?.content?.__metadata
                        ? {__metadata: candidate.content.__metadata}
                        : {}),
                },
                ...(candidate?.__metadata ? {__metadata: candidate.__metadata} : {}),
            }
        }
        // 5) If still nothing, try schema from this user's own metadata
        if (!replacement && user?.__metadata) {
            replacement = fromSchema(user.__metadata)
        }
        // 6) If still nothing, seed deterministic ids based on logicalTurnId
        if (!replacement) {
            const logicalId = last?.logicalTurnId as string | undefined
            if (logicalId) {
                replacement = {
                    __id: user?.__id || `user-${logicalId}`,
                    role: {
                        __id: user?.role?.__id || `role-${logicalId}`,
                        value: "user",
                        ...(user?.role?.__metadata ? {__metadata: user.role.__metadata} : {}),
                    },
                    content: {
                        __id: user?.content?.__id || `content-${logicalId}`,
                        value: "",
                        ...(user?.content?.__metadata ? {__metadata: user.content.__metadata} : {}),
                    },
                    ...(user?.__metadata ? {__metadata: user.__metadata} : {}),
                } as any
            }
        }

        if (replacement) {
            toPatch[lastId] = {
                ...last,
                userMessage: replacement,
            }
        }
    })

    if (Object.keys(toPatch).length === 0) return
    set(normChatTurnsByIdAtom, (prev) => ({...prev, ...toPatch}))
})
