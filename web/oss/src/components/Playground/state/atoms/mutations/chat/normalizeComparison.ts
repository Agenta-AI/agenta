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
 * Normalize existing chat turns for currently displayed revisions.
 * Ensures userMessage shape (role/content) and backfills missing session turns per revision.
 */
export const normalizeComparisonChatTurnsMutationAtom = atom(null, (get, set) => {
    const displayedRevIds = (get(displayedVariantsAtom) || []) as string[]
    if (!Array.isArray(displayedRevIds) || displayedRevIds.length === 0) return

    const sessions = get(normChatSessionsByIdAtom) as Record<string, any>
    const turns = get(normChatTurnsByIdAtom) as Record<string, any>

    const updatedTurns: Record<string, any> = {}

    // Helper to coerce Enhanced part arrays into ChatContentPart[] shape for schema builder
    const toSimpleContentArray = (val: any): any => {
        if (!Array.isArray(val)) return val
        try {
            return val
                .map((part: any) => {
                    if (!part || typeof part !== "object") return null
                    const type = (part?.type?.value ?? part?.type) as string | undefined
                    if (type === "text") {
                        const textVal =
                            typeof part?.text === "string"
                                ? part.text
                                : (part?.text?.value ?? "")
                        return {type: "text", text: textVal}
                    }
                    if (type === "image_url" || part?.imageUrl || part?.image_url) {
                        const urlVal =
                            part?.imageUrl?.url?.value ??
                            part?.imageUrl?.value ??
                            part?.image_url?.url ??
                            part?.image_url ??
                            part?.url ??
                            ""
                        const detail = part?.imageUrl?.detail?.value ?? part?.detail ?? "auto"
                        if (!urlVal) return null
                        return {type: "image_url", image_url: {url: urlVal, detail}}
                    }
                    return null
                })
                .filter(Boolean)
        } catch {
            return val
        }
    }

    displayedRevIds.forEach((revId) => {
        const sessionId = `session-${revId}`
        const session = sessions?.[sessionId]
        const turnIds: string[] = (session?.turnIds || []).filter(Boolean)

        // Derive revision-specific message metadata once per revision
        const revPrompts = (get(promptsAtomFamily(revId)) || []) as any[]
        const sample = revPrompts.flatMap((p: any) => p?.messages?.value || []).find(Boolean) as any
        const messageMetaId = sample?.__metadata as string | undefined
        const meta = messageMetaId ? (getMetadataLazy(messageMetaId) as any) : undefined

        turnIds.forEach((tid) => {
            const t = turns[tid]
            if (!t) return
            const um = t.userMessage || {}

            // Ensure role node exists and has value
            let roleNode = um.role
            if (!roleNode || typeof roleNode !== "object") {
                roleNode = {__id: `role-${tid}`, value: "user"}
            }
            if (typeof roleNode?.value !== "string") {
                roleNode = {...roleNode, value: "user"}
            }

            // Ensure content node exists and has value
            let contentNode = um.content
            if (!contentNode || typeof contentNode !== "object") {
                contentNode = {__id: `content-${tid}`, value: ""}
            }
            const cv = (contentNode as any).value
            if (cv === undefined) {
                contentNode = {...contentNode, value: ""}
            }

            // If revision has metadata and message lacks it, optionally regenerate minimal message
            let normalizedMessage = {
                __id: um.__id || `user-${tid}`,
                __metadata: um.__metadata,
                role: roleNode,
                content: contentNode,
            } as any

            if (meta) {
                // Preserve arrays (image/multi-part) and strings alike
                const preparedContent = Array.isArray(cv) ? toSimpleContentArray(cv) : cv
                const schemaMsg = createMessageFromSchema(meta, {
                    role: "user",
                    content: preparedContent,
                }) as any
                if (roleNode?.__id && schemaMsg?.role) schemaMsg.role.__id = roleNode.__id
                if (contentNode?.__id && schemaMsg?.content)
                    schemaMsg.content.__id = contentNode.__id
                if (um?.__id && schemaMsg) schemaMsg.__id = um.__id
                normalizedMessage = schemaMsg
            }

            const prev = t.userMessage
            const needsUpdate =
                !prev ||
                typeof prev?.role?.value !== "string" ||
                (prev?.content && prev.content.value === undefined)

            if (needsUpdate) {
                updatedTurns[tid] = {
                    ...t,
                    userMessage: normalizedMessage,
                }
            }
        })
    })

    if (Object.keys(updatedTurns).length > 0) {
        set(normChatTurnsByIdAtom, (prev) => ({...prev, ...updatedTurns}))
    }

    // Backfill: ensure every displayed revision has a mapped session turn for each existing logical turn
    try {
        const logicalIndex = (get(normLogicalTurnIndexAtom) || {}) as Record<
            string,
            Record<string, string>
        >
        const sessions2 = get(normChatSessionsByIdAtom) as Record<string, any>
        const turns2 = get(normChatTurnsByIdAtom) as Record<string, any>

        const toInsertTurns: Record<string, any> = {}
        const toUpdateSessions: Record<string, any> = {}
        const nextLogical: Record<string, Record<string, string>> = {...logicalIndex}

        Object.entries(logicalIndex || {}).forEach(([logicalId, map]) => {
            // Pick an anchor sid to derive insertion index
            const anchorSid = Object.values(map || {})[0]
            let anchorIndex: number | undefined
            let anchorSessionId: string | undefined
            if (anchorSid) {
                const anchorTurn = turns2[anchorSid as string]
                anchorSessionId = anchorTurn?.sessionId
                const anchorSession = sessions2[anchorSessionId || ""]
                if (anchorSession && Array.isArray(anchorSession.turnIds)) {
                    anchorIndex = anchorSession.turnIds.indexOf(anchorSid as string)
                }
            }

            displayedRevIds.forEach((revId) => {
                const existingSid = (map || {})[revId]
                if (existingSid) return

                const sessionId = `session-${revId}`
                const session = sessions2[sessionId]
                if (!session) return

                const newTurnId = `turn-${revId}-${logicalId}`
                if (turns2[newTurnId] || toInsertTurns[newTurnId]) {
                    nextLogical[logicalId] = {...(nextLogical[logicalId] || {}), [revId]: newTurnId}
                    return
                }

                // Build a user message for this revision
                const revPrompts = (get(promptsAtomFamily(revId)) || []) as any[]
                const sample = revPrompts
                    .flatMap((p: any) => p?.messages?.value || [])
                    .find(Boolean) as any
                const messageMetaId = sample?.__metadata as string | undefined
                const meta = messageMetaId ? (getMetadataLazy(messageMetaId) as any) : undefined
                let userMsg: any
                let sourceContent: any = undefined
                if (anchorSid && turns2[anchorSid as string]?.userMessage?.content) {
                    sourceContent = turns2[anchorSid as string].userMessage.content.value
                } else {
                    const existingSids = Object.values(map || {}) as string[]
                    for (const esid of existingSids) {
                        const t = turns2[esid]
                        const v = t?.userMessage?.content?.value
                        if (v !== undefined) {
                            sourceContent = v
                            break
                        }
                    }
                }

                if (meta) {
                    userMsg = createMessageFromSchema(meta, {
                        role: "user",
                        content: {value: ""},
                    })
                    if (sourceContent !== undefined) {
                        try {
                            const cloned = Array.isArray(sourceContent)
                                ? toSimpleContentArray(
                                      sourceContent.map((x: any) => ({...structuredClone(x)})),
                                  )
                                : typeof sourceContent === "object"
                                  ? {...structuredClone(sourceContent)}
                                  : sourceContent
                            if (userMsg?.content) userMsg.content.value = cloned as any
                        } catch {
                            if (userMsg?.content)
                                userMsg.content.value = Array.isArray(sourceContent)
                                    ? toSimpleContentArray(sourceContent)
                                    : sourceContent
                        }
                    }
                }
                if (!userMsg) {
                    userMsg = {
                        __id: `user-${logicalId}`,
                        role: {__id: `role-${logicalId}`, value: "user"},
                        content: {__id: `content-${logicalId}`, value: sourceContent ?? ""},
                    } as any
                }

                toInsertTurns[newTurnId] = {
                    id: newTurnId,
                    sessionId,
                    logicalTurnId: logicalId,
                    userMessage: userMsg,
                    assistantMessageByRevision: {[revId]: null},
                    meta: {},
                }

                const ids = Array.isArray(session.turnIds) ? [...session.turnIds] : []
                const insertAt =
                    typeof anchorIndex === "number" && anchorIndex >= 0
                        ? Math.min(anchorIndex, ids.length)
                        : ids.length
                ids.splice(insertAt, 0, newTurnId)
                toUpdateSessions[sessionId] = {...session, turnIds: ids}

                nextLogical[logicalId] = {...(nextLogical[logicalId] || {}), [revId]: newTurnId}
            })
        })

        if (Object.keys(toInsertTurns).length > 0) {
            set(normChatTurnsByIdAtom, (prev) => ({...prev, ...toInsertTurns}))
        }
        if (Object.keys(toUpdateSessions).length > 0) {
            set(normChatSessionsByIdAtom, (prev) => ({...prev, ...toUpdateSessions}))
        }
        if (JSON.stringify(nextLogical) !== JSON.stringify(logicalIndex)) {
            set(normLogicalTurnIndexAtom, nextLogical as any)
        }
    } catch {}
})
