import {atom} from "jotai"

import {generateId} from "@/oss/lib/shared/variant/stringUtils"
import {
    chatSessionIdsAtom as normChatSessionIdsAtom,
    chatSessionsByIdAtom as normChatSessionsByIdAtom,
    chatTurnsByIdAtom as normChatTurnsByIdAtom,
    inputRowIdsAtom as normInputRowIdsAtom,
    inputRowsByIdAtom as normInputRowsByIdAtom,
    logicalTurnIndexAtom as normLogicalTurnIndexAtom,
    rowIdIndexAtom as normRowIdIndexAtom,
    type NormInputRow,
    type NormPropertyNode,
} from "@/oss/state/generation/entities"
import {promptVariablesAtomFamily, promptsAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {variantFlagsAtomFamily} from "@/oss/state/newPlayground/core/variantFlags"

import {appChatModeAtom} from "../../app"
import {displayedVariantsAtom} from "../../variants"
import {schemaInputKeysAtom} from "../../variants"

/**
 * Add a new generation input row
 */
export const addGenerationInputRowMutationAtom = atom(null, (get, set) => {
    const isChatVariant = get(appChatModeAtom)
    const displayedRevIds = (get(displayedVariantsAtom) || []) as string[]

    if (isChatVariant) {
        // CHAT MODE: ensure a session per displayed revision
        const sessionIds: string[] = []
        set(normChatSessionsByIdAtom, (prev) => {
            const next = {...prev}
            displayedRevIds.forEach((revId) => {
                const sid = `session-${revId}`
                sessionIds.push(sid)
                if (!next[sid]) {
                    // Resolve per-revision required variables
                    const flags = get(variantFlagsAtomFamily({revisionId: revId})) as any
                    const isCustom = !!flags?.isCustom
                    const schemaKeys = get(schemaInputKeysAtom) || []
                    const perRevVars = (
                        isCustom
                            ? schemaKeys
                            : ((get(promptVariablesAtomFamily(revId)) || []) as string[])
                    ) as string[]
                    next[sid] = {
                        id: sid,
                        variablesByRevision: {
                    [revId]: perRevVars.map((v) => ({
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
        // Maintain session id list (order by displayedRevIds)
        set(normChatSessionIdsAtom, (_prev) => sessionIds)

        // Create a shared logical turn id and one session-specific turn per revision
        const logicalTurnId = `lt-${generateId()}`
        const mapping: Record<string, string> = {}

        // Create turns
        const turnsToInsert: Record<string, any> = {}
        // Prepare message metadata from prompts (use first displayed revision)
        const baselineRev = displayedRevIds[0]
        const prompts = baselineRev ? get(promptsAtomFamily(baselineRev)) : []
        // Try to find a sample message to copy metadata ids from
        const sampleMessage = ((prompts as any[]) || [])
            .flatMap((p: any) => p?.messages?.value || [])
            .find(Boolean) as any
        const roleMetaId = sampleMessage?.role?.__metadata
        const contentMetaId = sampleMessage?.content?.__metadata
        const messageMetaId = sampleMessage?.__metadata
        displayedRevIds.forEach((revId) => {
            const sessionId = `session-${revId}`
            const sessionTurnId = `turn-${revId}-${logicalTurnId}`
            mapping[revId] = sessionTurnId
            turnsToInsert[sessionTurnId] = {
                id: sessionTurnId,
                sessionId,
                logicalTurnId,
                userMessage: {
                    __id: messageMetaId ? `msg-${logicalTurnId}` : `user-${logicalTurnId}`,
                    __metadata: messageMetaId || undefined,
                    role: roleMetaId
                        ? {__id: `role-${logicalTurnId}`, __metadata: roleMetaId, value: "user"}
                        : ({__id: `role-${logicalTurnId}`, value: "user"} as any),
                    content: contentMetaId
                        ? {__id: `content-${logicalTurnId}`, __metadata: contentMetaId, value: ""}
                        : ({__id: `content-${logicalTurnId}`, value: ""} as any),
                },
                assistantMessageByRevision: {[revId]: null},
                meta: {},
            }
        })

        // Write turns
        set(normChatTurnsByIdAtom, (prev) => ({...prev, ...turnsToInsert}))

        // Append to each session's turn list
        set(normChatSessionsByIdAtom, (prev) => {
            const next = {...prev}
            displayedRevIds.forEach((revId) => {
                const sid = `session-${revId}`
                const stid = mapping[revId]
                const sess = next[sid]
                const arr = [...(sess?.turnIds || []), stid]
                next[sid] = {...sess, turnIds: arr}
            })
            return next
        })

        // Update logical turn index
        set(normLogicalTurnIndexAtom, (prev) => ({...prev, [logicalTurnId]: mapping}))

        return
    }

    // COMPLETION MODE: add normalized input row
    const ids = get(normInputRowIdsAtom)
    const hasTemplate = ids.length > 0

    const newRowId = `row-${generateId()}`
    let variablesByRevision: Record<string, NormPropertyNode[]> = {}
    if (hasTemplate) {
        const first = get(normInputRowsByIdAtom)[ids[0]] as NormInputRow | undefined
        if (first) {
            variablesByRevision = Object.fromEntries(
                Object.entries(first.variablesByRevision || {}).map(([revId, nodes]) => [
                    revId,
                    (nodes || []).map((n) => {
                        const cloned = {...structuredClone(n)} as any
                        // New test case should start empty: clear both value and content.value
                        if (Object.prototype.hasOwnProperty.call(cloned, "value")) cloned.value = ""
                        if (cloned?.content && typeof cloned.content === "object") {
                            cloned.content = {...cloned.content, value: ""}
                        }
                        return cloned
                    }),
                ]),
            )
        }
    } else {
        displayedRevIds.forEach((revId) => {
            const flags = get(variantFlagsAtomFamily({revisionId: revId})) as any
            const isCustom = !!flags?.isCustom
            const schemaKeys = get(schemaInputKeysAtom) || []
            const perRevVars = (
                isCustom ? schemaKeys : ((get(promptVariablesAtomFamily(revId)) || []) as string[])
            ) as string[]
            variablesByRevision[revId] = perRevVars.map((v) => ({
                __id: generateId(),
                key: v,
                value: "",
                content: {value: ""},
            }))
        })
    }

    const newRow: NormInputRow = {
        id: newRowId,
        variablesByRevision,
        responsesByRevision: {},
        meta: {},
    }

    set(normInputRowsByIdAtom, (prev) => ({...prev, [newRowId]: newRow}))
    set(normInputRowIdsAtom, (prev) => [...prev, newRowId])
    set(normRowIdIndexAtom, (prev) => ({
        ...prev,
        [newRowId]: {latestRevisionId: displayedRevIds?.[0]},
    }))

    // No legacy mirroring needed for completion add.
})
