import {atom} from "jotai"

import {createMessageFromSchema} from "@/oss/components/Playground/hooks/usePlayground/assets/messageHelpers"
import {getMetadataLazy} from "@/oss/lib/hooks/useStatelessVariants/state"
import {generateId} from "@/oss/lib/shared/variant/stringUtils"
import {
    chatSessionIdsAtom as normChatSessionIdsAtom,
    chatSessionsByIdAtom as normChatSessionsByIdAtom,
    chatTurnsByIdAtom as normChatTurnsByIdAtom,
    inputRowIdsAtom as normInputRowIdsAtom,
    inputRowsByIdAtom as normInputRowsByIdAtom,
    logicalTurnIndexAtom as normLogicalTurnIndexAtom,
} from "@/oss/state/generation/entities"
import {promptsAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {variantFlagsAtomFamily} from "@/oss/state/newPlayground/core/variantFlags"

import {
    normalizeComparisonChatTurnsMutationAtom,
    pruneLogicalTurnIndexForDisplayedVariantsMutationAtom,
} from "../../generationMutations"
import {addEmptyChatTurnSystemMutationAtom} from "../../mutations/chat/addEmptyTurnSystem"
import {forceSyncPromptVariablesToNormalizedAtom} from "../../mutations/sync/forceSyncPromptVariables"
import {
    displayedVariantsAtom,
    displayedVariantsVariablesAtom,
    schemaInputKeysAtom,
} from "../../variants"

/**
 * Load testset rows into normalized store only (no legacy generationData writes).
 * - Completion: seeds inputRowsByIdAtom with variables for each displayed revision.
 * - Chat: ensures sessions and seeds one or more user turns from testset messages.
 * Custom workflows derive variables from schema keys when available.
 */
export const loadTestsetNormalizedMutationAtom = atom(
    null,
    (
        get,
        set,
        params: {
            testsetData: Record<string, any>[]
            isChatVariant?: boolean
        },
    ) => {
        const {testsetData = [], isChatVariant = false} = params || ({} as any)

        if (!Array.isArray(testsetData) || testsetData.length === 0) return

        const displayedRevIds = (get(displayedVariantsAtom) || []) as string[]

        if (!Array.isArray(displayedRevIds) || displayedRevIds.length === 0) return

        // Resolve variable keys per revision (custom uses schema, otherwise prompt-derived vars)
        const displayedVars = (get(displayedVariantsVariablesAtom) || []) as string[]
        const schemaKeys = (get(schemaInputKeysAtom) || []) as string[]

        const firstRow = testsetData[0]

        // Reset existing data before loading the new testset
        if (!isChatVariant) {
            // COMPLETION: remove all existing input rows
            set(normInputRowsByIdAtom, {})
            set(normInputRowIdsAtom, [])
        } else {
            // CHAT: remove sessions, turns, and logical index
            set(normChatTurnsByIdAtom, {})
            set(normChatSessionsByIdAtom, {})
            set(normChatSessionIdsAtom, [])
            set(normLogicalTurnIndexAtom, {})
        }

        if (!isChatVariant) {
            // COMPLETION: create one normalized input row per selected testset row
            const rowsToInsert: Record<string, any> = {}
            const idsToAppend: string[] = []

            // Derivation helpers for custom: prefer schema keys; else displayed vars; else derive from row
            const messageFieldKeys = new Set([
                "messages",
                "correct_answer",
                "expected_output",
                "ground_truth",
                "target",
                "label",
            ])

            testsetData.forEach((rowData) => {
                const newRowId = `row-${generateId()}`
                const variablesByRevision: Record<string, any[]> = {}
                displayedRevIds.forEach((revId) => {
                    const flags = get(variantFlagsAtomFamily({revisionId: revId})) as any
                    const isCustom = !!flags?.isCustom
                    const derivedKeys = Object.keys(rowData || {}).filter(
                        (k) => !messageFieldKeys.has(k),
                    )
                    const keys = (
                        isCustom && schemaKeys.length > 0
                            ? schemaKeys
                            : displayedVars && displayedVars.length > 0
                              ? displayedVars
                              : derivedKeys
                    ) as string[]

                    variablesByRevision[revId] = (keys || []).map((k) => ({
                        __id: generateId(),
                        key: k,
                        value: rowData?.[k] ?? "",
                        content: {value: rowData?.[k] ?? ""},
                    }))
                })

                rowsToInsert[newRowId] = {
                    id: newRowId,
                    variablesByRevision,
                    responsesByRevision: {},
                    meta: {},
                } as any
                idsToAppend.push(newRowId)
            })

            if (Object.keys(rowsToInsert).length > 0) {
                set(normInputRowsByIdAtom, (prev) => ({...prev, ...rowsToInsert}))
                set(normInputRowIdsAtom, (prev) => [...prev, ...idsToAppend])
            }
            return
        }

        // CHAT VARIANT
        // Ensure sessions exist for each displayed revision and seed variables from testset row
        set(normChatSessionsByIdAtom, (prev) => {
            const next = {...prev}
            displayedRevIds.forEach((revId) => {
                const sid = `session-${revId}`
                if (!next[sid]) {
                    next[sid] = {id: sid, variablesByRevision: {}, turnIds: [], meta: {}} as any
                }
                const flags = get(variantFlagsAtomFamily({revisionId: revId})) as any
                const isCustom = !!flags?.isCustom
                // Prefer schema keys for custom, else prompt vars, else derive from testset row
                const messageFieldKeys = new Set([
                    "messages",
                    "correct_answer",
                    "expected_output",
                    "ground_truth",
                    "target",
                    "label",
                ])
                const derivedKeys = Object.keys(firstRow || {}).filter(
                    (k) => !messageFieldKeys.has(k),
                )
                const keys = (
                    isCustom && schemaKeys.length > 0
                        ? schemaKeys
                        : displayedVars && displayedVars.length > 0
                          ? displayedVars
                          : derivedKeys
                ) as string[]

                // Non-destructive merge by key: update existing nodes, add missing
                const existing = (next[sid].variablesByRevision?.[revId] || []) as any[]
                const byKey = new Map<string, any>()
                existing.forEach((n) => byKey.set(String(n?.key ?? n?.__id ?? ""), n))
                const updated: any[] = []
                for (const k of keys) {
                    const prevNode = byKey.get(k)
                    const v = firstRow?.[k] ?? ""
                    if (prevNode) {
                        if (prevNode.content && typeof prevNode.content === "object") {
                            prevNode.content.value = v
                        } else {
                            prevNode.value = v
                        }
                        updated.push(prevNode)
                    } else {
                        updated.push({
                            __id: generateId(),
                            key: k,
                            value: v,
                            content: {value: v},
                        })
                    }
                }
                next[sid].variablesByRevision = {
                    ...(next[sid].variablesByRevision || {}),
                    [revId]: updated,
                }
            })
            return next
        })
        set(normChatSessionIdsAtom, (_prev) => displayedRevIds.map((r) => `session-${r}`))

        // Mirror chat variables into normalized input rows so variable UI selectors (which read inputRowsByIdAtom)
        // can render them in chat/custom apps as well.
        try {
            const flagsByRev: Record<string, boolean> = {}
            const pickedKeysByRev: Record<string, string[]> = {}
            const messageFieldKeys = new Set([
                "messages",
                "correct_answer",
                "expected_output",
                "ground_truth",
                "target",
                "label",
            ])
            const derivedKeys = Object.keys(firstRow || {}).filter((k) => !messageFieldKeys.has(k))
            displayedRevIds.forEach((revId) => {
                const flags = get(variantFlagsAtomFamily({revisionId: revId})) as any
                const isCustom = !!flags?.isCustom
                flagsByRev[revId] = isCustom
                const keys = (
                    isCustom && schemaKeys.length > 0
                        ? schemaKeys
                        : displayedVars && displayedVars.length > 0
                          ? displayedVars
                          : derivedKeys
                ) as string[]
                pickedKeysByRev[revId] = keys
            })

            const existingIds = (get(normInputRowIdsAtom) || []) as string[]
            const creatingNew = !(existingIds && existingIds.length > 0)
            const rowId = creatingNew ? `row-${generateId()}` : existingIds[0]
            const variablesByRevision: Record<string, any[]> = {}
            displayedRevIds.forEach((revId) => {
                // Rebuild key -> provider id map for mirroring as well
                const revPrompts = (get(promptsAtomFamily(revId)) || []) as any[]
                const stack = revPrompts as any[]
                const findIn = (obj: any, targetKey: string): string | null => {
                    if (!obj) return null
                    if (typeof obj === "object") {
                        if ((obj.key || obj.__id) && String(obj.key || "") === targetKey) {
                            return obj.__id || null
                        }
                        for (const v of Object.values(obj)) {
                            const r = findIn(v as any, targetKey)
                            if (r) return r
                        }
                    } else if (Array.isArray(obj)) {
                        for (const it of obj) {
                            const r = findIn(it as any, targetKey)
                            if (r) return r
                        }
                    }
                    return null
                }
                const map: Record<string, string> = {}
                for (const k of pickedKeysByRev[revId] || []) {
                    const pid = findIn(stack, k)
                    if (pid) map[k] = pid
                }
                // Non-destructive merge for input rows as well
                const prev = (get(normInputRowsByIdAtom) || {}) as Record<string, any>
                const prevRow = creatingNew ? null : prev[rowId]
                const existingNodes = (prevRow?.variablesByRevision?.[revId] || []) as any[]
                const byKeyRow = new Map<string, any>()
                existingNodes.forEach((n) => byKeyRow.set(String(n?.key ?? n?.__id ?? ""), n))
                const updatedRowVars: any[] = []
                for (const k of pickedKeysByRev[revId] || []) {
                    const prevNode = byKeyRow.get(k)
                    const v = firstRow?.[k] ?? ""
                    if (prevNode) {
                        if (prevNode.content && typeof prevNode.content === "object") {
                            prevNode.content.value = v
                        } else {
                            prevNode.value = v
                        }
                        updatedRowVars.push(prevNode)
                    } else {
                        updatedRowVars.push({
                            __id: generateId(),
                            key: k,
                            value: v,
                            content: {value: v},
                        })
                    }
                }
                variablesByRevision[revId] = updatedRowVars
            })

            set(normInputRowsByIdAtom, (prev) => {
                const next = {...(prev || {})}
                const targetIds = creatingNew ? [rowId] : existingIds
                targetIds.forEach((id) => {
                    const prevRow = next[id]
                    next[id] = {
                        id,
                        variablesByRevision,
                        responsesByRevision: prevRow?.responsesByRevision || {},
                        meta: prevRow?.meta || {},
                    } as any
                })
                return next
            })
            if (creatingNew) {
                set(normInputRowIdsAtom, (prev) =>
                    Array.isArray(prev) && prev.length > 0 ? prev : [rowId],
                )
            }
            // No deferred overwrite; avoid id churn in comparison mode
        } catch {}

        // After seeding variables, force-sync to prompt-defined variables to align shapes/ids
        set(forceSyncPromptVariablesToNormalizedAtom)

        // Seed turns from messages[] across all selected rows (not just the first)
        const allMessages: any[] = []
        testsetData.forEach((row) => {
            const raw = (row as any)?.messages
            if (!raw) return
            if (Array.isArray(raw) && raw.length > 0) {
                allMessages.push(...(raw as any[]))
                return
            }
            if (typeof raw === "string") {
                try {
                    const parsed = JSON.parse(raw)
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        allMessages.push(...parsed)
                    }
                } catch {}
            }
        })

        if (allMessages.length > 0) {
            // Obtain message metadata from prompts of the first displayed revision
            let messageMetadata: any | undefined
            const baseline = displayedRevIds[0]
            const revPrompts = (get(promptsAtomFamily(baseline)) || []) as any[]
            const sample = revPrompts
                .flatMap((p: any) => p?.messages?.value || [])
                .find(Boolean) as any
            messageMetadata = sample?.__metadata ? getMetadataLazy(sample.__metadata) : undefined

            const turnsToInsert: Record<string, any> = {}
            const sessionsToUpdate: Record<string, any> = {}
            const logicalUpdates: Record<string, Record<string, string>> = {}
            // Track last logical turn ids to attach assistant messages
            let currentLogicalId: string | null = null
            let currentMap: Record<string, string> | null = null

            allMessages.forEach((m) => {
                const role = (m?.role || m?.role?.value || "user").toLowerCase()
                const rawContent = m?.content
                const contentVal = Array.isArray(rawContent)
                    ? (() => {
                          const textParts = rawContent
                              .filter((p: any) => p?.type?.value === "text" || p?.type === "text")
                              .map((p: any) => p?.text?.value ?? p?.text ?? "")
                          if (textParts.length > 0) return textParts.join(" ")

                          try {
                              return JSON.stringify(rawContent)
                          } catch {
                              return ""
                          }
                      })()
                    : (rawContent ?? "")
                if (role === "assistant") {
                    if (!currentLogicalId || !currentMap) return
                    // Attach assistant content to the existing logical turn across revisions
                    displayedRevIds.forEach((revId) => {
                        const turnId = (currentMap as any)[revId]
                        if (!turnId) return
                        const prev =
                            turnsToInsert[turnId] || (get(normChatTurnsByIdAtom) as any)[turnId]
                        let assistantMsg = messageMetadata
                            ? createMessageFromSchema(messageMetadata, {
                                  role: "assistant",
                                  content: contentVal,
                              } as any)
                            : {
                                  __id: `assistant-${currentLogicalId}`,
                                  role: {
                                      __id: `role-assistant-${currentLogicalId}`,
                                      value: "assistant",
                                  },
                                  content: {
                                      __id: `content-assistant-${currentLogicalId}`,
                                      value: contentVal,
                                  },
                              }
                        const nextTurn = {
                            ...(prev || {}),
                            assistantMessageByRevision: {
                                ...((prev || {}).assistantMessageByRevision || {}),
                                [revId]: assistantMsg,
                            },
                        }
                        turnsToInsert[turnId] = nextTurn
                    })
                    return
                }

                // Start a new logical turn for a user message
                const logicalId = `lt-${generateId()}`
                const mapping: Record<string, string> = {}
                displayedRevIds.forEach((revId) => {
                    const sid = `session-${revId}`
                    const turnId = `turn-${revId}-${logicalId}`
                    mapping[revId] = turnId
                    const messageData = {
                        role: "user",
                        content: contentVal,
                    }
                    let userMsg = messageMetadata
                        ? createMessageFromSchema(messageMetadata, messageData as any)
                        : {
                              __id: `user-${logicalId}`,
                              role: {__id: `role-${logicalId}`, value: "user"},
                              content: {
                                  __id: `content-${logicalId}`,
                                  value: messageData.content,
                              },
                          }
                    const prevSess =
                        sessionsToUpdate[sid] || (get(normChatSessionsByIdAtom) as any)[sid]
                    const arr = Array.isArray(prevSess?.turnIds)
                        ? [...prevSess.turnIds]
                        : ([] as string[])
                    const nextTurn = {
                        id: turnId,
                        sessionId: sid,
                        logicalTurnId: logicalId,
                        userMessage: userMsg,
                        assistantMessageByRevision: {[revId]: null},
                        meta: {},
                    }
                    turnsToInsert[turnId] = nextTurn
                    sessionsToUpdate[sid] = {
                        ...(prevSess || {
                            id: sid,
                            variablesByRevision: {},
                            turnIds: [],
                            meta: {},
                        }),
                        turnIds: [...arr, turnId],
                    }
                })
                logicalUpdates[logicalId] = mapping
                currentLogicalId = logicalId
                currentMap = mapping
            })

            console.log("turnsToInsert", turnsToInsert)

            if (Object.keys(turnsToInsert).length > 0) {
                set(normChatTurnsByIdAtom, (prev) => ({...prev, ...turnsToInsert}))
            }
            if (Object.keys(sessionsToUpdate).length > 0) {
                set(normChatSessionsByIdAtom, (prev) => ({...prev, ...sessionsToUpdate}))
            }
            if (Object.keys(logicalUpdates).length > 0) {
                set(normLogicalTurnIndexAtom, (prev) => ({...(prev || {}), ...logicalUpdates}))
            }
        }

        // Ensure a trailing empty user input exists (single or comparison)
        try {
            const sessions = (get(normChatSessionsByIdAtom) || {}) as Record<string, any>
            const turns = (get(normChatTurnsByIdAtom) || {}) as Record<string, any>
            const needsTail = (() => {
                // Decide based on baseline revision for stability across displayed set
                const baseline = displayedRevIds[0]
                const sid = `session-${baseline}`
                const sess = sessions[sid]
                const ids = (sess?.turnIds || []) as string[]
                if (ids.length === 0) return true
                const lastId = ids[ids.length - 1]
                const last = turns[lastId]
                const user = last?.userMessage
                const v = user?.content?.value
                const assistantForBaseline = last?.assistantMessageByRevision?.[baseline]
                const userHasContent =
                    typeof v === "string"
                        ? v.trim().length > 0
                        : Array.isArray(v)
                          ? v.length > 0
                          : false
                // If the last message is a user message WITH content and no assistant yet,
                // do NOT append a trailing empty turn.
                if (userHasContent && !assistantForBaseline) return false
                // Otherwise (assistant present or empty user), append a trailing input
                return true
            })()
            if (needsTail) {
                set(addEmptyChatTurnSystemMutationAtom)
            }
            // Normalize and prune index so UI reflects changes immediately in single or comparison
            set(normalizeComparisonChatTurnsMutationAtom)
            set(pruneLogicalTurnIndexForDisplayedVariantsMutationAtom)
        } catch {}
    },
)
