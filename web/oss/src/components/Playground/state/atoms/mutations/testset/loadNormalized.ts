import {generateId} from "@agenta/shared/utils"
import {atom} from "jotai"

import {createMessageFromSchema} from "@/oss/components/Playground/hooks/usePlayground/assets/messageHelpers"
import {
    inputRowsByIdFamilyAtom,
    inputRowIdsAtom,
    inputRowsByIdAtom,
    inputRowsByIdCacheAtom,
    inputRowVariableValueCacheAtom,
    rowIdIndexAtom,
    chatTurnIdsAtom,
    chatSessionsByIdAtom,
    chatSessionIdsAtom,
    chatTurnsByIdStorageAtom,
    chatTurnsByIdCacheAtom,
    allChatTurnIdsMapAtom,
    chatTurnIdsByBaselineAtom,
    messageSchemaMetadataAtom,
} from "@/oss/state/generation/entities"
import {normalizeMessagesFromField} from "@/oss/state/newPlayground/chat/parsers"
import {buildUserMessage} from "@/oss/state/newPlayground/helpers/messageFactory"

import {displayedVariantsAtom} from "../../variants"

// Helper constants and utilities
const MESSAGE_FIELD_KEYS = new Set([
    "messages",
    "correct_answer",
    "expected_output",
    "ground_truth",
    "target",
    "label",
])

type NormalizedContentPart =
    | {type: "text"; text: string}
    | {type: "image_url"; image_url: {url: string; detail?: string}}
    | {
          type: "file"
          file: {file_id: string; name?: string; mime_type?: string}
      }

const unwrapValue = (input: any): any => {
    const visited = new Set<any>()
    let current = input
    while (
        current &&
        typeof current === "object" &&
        "value" in current &&
        current.value !== undefined &&
        current.value !== current &&
        !visited.has(current)
    ) {
        visited.add(current)
        current = (current as any).value
    }
    return current
}

const asString = (raw: any): string | undefined => {
    const value = unwrapValue(raw)
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    return undefined
}

const buildImagePart = (raw: any): NormalizedContentPart | null => {
    const value = unwrapValue(raw)
    if (!value || typeof value !== "object") return null
    const url = asString((value as any).url ?? (value as any).uri ?? value)
    if (!url) return null
    const detail = asString((value as any).detail)
    const part: NormalizedContentPart = {type: "image_url", image_url: {url}}
    if (detail && detail.length > 0) part.image_url.detail = detail
    return part
}

const buildFilePart = (raw: any): NormalizedContentPart | null => {
    const value = unwrapValue(raw)
    if (!value || typeof value !== "object") return null
    const fileId = asString((value as any).file_id ?? (value as any).fileId ?? value)
    const fileData = asString((value as any).file_data ?? (value as any).fileData)
    if (!fileId && !fileData) return null
    const name = asString((value as any).name)

    const mimeType = asString((value as any).format ?? (value as any).format)
    const filePart: NormalizedContentPart = {
        type: "file",
        file: {},
    }
    if (fileId) filePart.file.file_id = fileId
    if (fileData) filePart.file.file_data = fileData
    if (name) filePart.file.name = name
    if (mimeType) filePart.file.format = mimeType

    return filePart
}

const normalizeContentPart = (part: any): NormalizedContentPart | null => {
    const value = unwrapValue(part)
    if (value == null) return null

    const primitive = asString(value)
    if (primitive !== undefined) {
        return primitive.length > 0 ? {type: "text", text: primitive} : null
    }

    if (typeof value !== "object") return null

    const explicitType = asString((value as any).type)?.toLowerCase()
    if (explicitType === "image_url") {
        return buildImagePart((value as any).image_url ?? (value as any).imageUrl)
    }
    if (explicitType === "file") {
        return buildFilePart((value as any).file)
    }

    const imageCandidate = (value as any).image_url ?? (value as any).imageUrl
    const imagePart = imageCandidate ? buildImagePart(imageCandidate) : null
    if (imagePart) return imagePart

    const fileCandidate = (value as any).file
    const filePart = fileCandidate ? buildFilePart(fileCandidate) : null
    if (filePart) return filePart

    const textValue =
        asString((value as any).text) ??
        asString((value as any).content) ??
        asString((value as any).message) ??
        asString(value)

    if (textValue && textValue.length > 0) return {type: "text", text: textValue}

    return null
}

const normalizeMessageContent = (raw: any): string | NormalizedContentPart[] => {
    const value = unwrapValue(raw)

    const primitive = asString(value)
    if (primitive !== undefined) return primitive

    if (Array.isArray(value)) {
        const parts = value
            .map((item) => normalizeContentPart(item))
            .filter((item): item is NormalizedContentPart => Boolean(item))
        return parts.length > 0 ? parts : ""
    }

    if (value && typeof value === "object") {
        const nested = (value as any).content ?? (value as any).parts
        if (nested && nested !== value) {
            const normalized = normalizeMessageContent(nested)
            if (typeof normalized === "string") {
                if (normalized.length > 0) return normalized
            } else if (normalized.length > 0) {
                return normalized
            }
        }

        const single = normalizeContentPart(value)
        if (single) return [single]
    }

    return ""
}

const toolContentToString = (raw: any): string => {
    const normalized = normalizeMessageContent(raw)
    if (Array.isArray(normalized)) {
        if (normalized.length === 0) return ""
        return normalized
            .map((part) => {
                if (!part) return ""
                if (part.type === "text") return part.text
                if (part.type === "image_url") {
                    try {
                        return JSON.stringify(part.image_url)
                    } catch {
                        return String(part.image_url)
                    }
                }
                if (part.type === "file") {
                    try {
                        return JSON.stringify(part.file)
                    } catch {
                        return String(part.file)
                    }
                }
                return ""
            })
            .filter(Boolean)
            .join("\n")
    }
    if (typeof normalized === "string") return normalized
    if (raw == null) return ""
    if (typeof raw === "string") return raw
    try {
        return JSON.stringify(raw, null, 2)
    } catch {
        return String(raw)
    }
}

/**
 * Load testset rows into normalized store only.
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
            regenerateVariableIds?: boolean
        },
    ) => {
        const {
            testsetData = [],
            isChatVariant = false,
            regenerateVariableIds = false,
        } = params || ({} as any)
        if (!Array.isArray(testsetData) || testsetData.length === 0) return

        const displayedRevIds = (get(displayedVariantsAtom) || []) as string[]
        const baseline = displayedRevIds?.[0]
        const targetRevisionIds =
            displayedRevIds && displayedRevIds.length > 0 ? displayedRevIds : [baseline || ""]
        const sessionId = `session-${baseline || targetRevisionIds[0] || "default"}`

        // 1) Variables: load for chat vs completion appropriately
        const dataset = Array.isArray(testsetData) ? testsetData : []
        if (isChatVariant) {
            // Reset chat caches to avoid stale turns/sessions from previous state
            set(chatTurnIdsAtom, [])
            set(chatTurnsByIdStorageAtom, {})
            set(chatTurnsByIdCacheAtom, {})
            set(allChatTurnIdsMapAtom, {})
            set(chatTurnIdsByBaselineAtom, {})
            set(chatSessionIdsAtom, [sessionId])
            set(chatSessionsByIdAtom, {
                [sessionId]: {
                    id: sessionId,
                    variables: [],
                    turnIds: [],
                    meta: {},
                },
            })

            // Chat: update the single default row without resetting the input rows map
            const rowData = (dataset[0] || {}) as Record<string, any>
            const newRowId = `row-__default__`
            const keys = Object.keys(rowData || {}).filter((k) => !MESSAGE_FIELD_KEYS.has(k))

            set(rowIdIndexAtom, (prev) => ({
                ...(prev || {}),
                [newRowId]: {latestRevisionId: baseline},
            }))
            set(inputRowsByIdFamilyAtom(newRowId), (draft: any) => {
                if (!draft) return
                if (!Array.isArray(draft.variables)) draft.variables = []

                const byName = new Map<string, any>()
                for (const n of draft.variables) {
                    const k = (n as any)?.key ?? (n as any)?.__id
                    if (typeof k === "string" && k) byName.set(k, n)
                }
                for (const k of keys) {
                    const vRaw = (rowData as any)[k]
                    if (vRaw === undefined) continue
                    const v = Array.isArray(vRaw)
                        ? JSON.stringify(vRaw)
                        : typeof vRaw === "string"
                          ? vRaw
                          : String(vRaw ?? "")
                    const node = byName.get(k)
                    if (!node) continue
                    if (node.content && typeof node.content === "object") node.content.value = v
                    ;(node as any).value = v
                    if (regenerateVariableIds) (node as any).__id = generateId()
                }
            })
        } else {
            // Completion: reset and create a row per dataset item
            set(inputRowIdsAtom, [])
            set(inputRowsByIdAtom, {})
            set(inputRowsByIdCacheAtom, {})
            set(inputRowVariableValueCacheAtom, {})
            set(rowIdIndexAtom, {})
            for (const rowDataRaw of dataset) {
                const rowData = (rowDataRaw || {}) as Record<string, any>
                const newRowId = `row-${generateId()}`
                const keys = Object.keys(rowData || {}).filter((k) => !MESSAGE_FIELD_KEYS.has(k))
                set(rowIdIndexAtom, (prev) => ({
                    ...(prev || {}),
                    [newRowId]: {latestRevisionId: baseline},
                }))
                set(inputRowsByIdFamilyAtom(newRowId), (draft: any) => {
                    if (!draft) return
                    if (!Array.isArray(draft.variables)) draft.variables = []

                    const byName = new Map<string, any>()
                    for (const n of draft.variables) {
                        const k = (n as any)?.key ?? (n as any)?.__id
                        if (typeof k === "string" && k) byName.set(k, n)
                    }
                    for (const k of keys) {
                        const vRaw = (rowData as any)[k]
                        if (vRaw === undefined) continue
                        const v = Array.isArray(vRaw)
                            ? JSON.stringify(vRaw)
                            : typeof vRaw === "string"
                              ? vRaw
                              : String(vRaw ?? "")
                        const node = byName.get(k)
                        if (!node) continue
                        if (node.content && typeof node.content === "object") node.content.value = v
                        ;(node as any).value = v
                        if (regenerateVariableIds) (node as any).__id = generateId()
                    }
                })
                set(inputRowIdsAtom, (prev) => [...(prev || []), newRowId])
            }
        }

        if (!isChatVariant) {
            // Completion mode: no chat messages to load
            return
        }

        // 2) Messages: create chat turns from messages arrays in rows
        const datasetMessages = testsetData.map((row) => normalizeMessagesFromField(row.messages))
        const allMessages = datasetMessages.flat()
        if (Array.isArray(allMessages) && allMessages.length > 0) {
            const messageSchema = get(messageSchemaMetadataAtom) as any
            const revisionIds = targetRevisionIds.filter(
                (rev) => typeof rev === "string" && rev.length > 0,
            )
            if (revisionIds.length === 0) {
                if (baseline) revisionIds.push(baseline)
                else if (targetRevisionIds[0]) revisionIds.push(targetRevisionIds[0])
                else revisionIds.push("__default__")
            }

            const newTurnIds: string[] = []
            const newTurnsById: Record<string, any> = {}

            for (const rowMessages of datasetMessages) {
                if (!Array.isArray(rowMessages) || rowMessages.length === 0) continue

                let cursor = 0
                while (cursor < rowMessages.length) {
                    let userIndex = -1
                    for (let idx = cursor; idx < rowMessages.length; idx++) {
                        if (rowMessages[idx]?.role === "user") {
                            userIndex = idx
                            break
                        }
                    }
                    if (userIndex === -1) break

                    const userMessage = rowMessages[userIndex]
                    let nextUserIndex = -1
                    for (let idx = userIndex + 1; idx < rowMessages.length; idx++) {
                        if (rowMessages[idx]?.role === "user") {
                            nextUserIndex = idx
                            break
                        }
                    }

                    const turnMessages =
                        nextUserIndex === -1
                            ? rowMessages.slice(userIndex + 1)
                            : rowMessages.slice(userIndex + 1, nextUserIndex)
                    cursor = nextUserIndex === -1 ? rowMessages.length : nextUserIndex

                    const logicalId = `lt-${generateId()}`
                    newTurnIds.push(logicalId)

                    const userContent = normalizeMessageContent(userMessage.content)
                    const assistantSource = Array.isArray(turnMessages)
                        ? [...turnMessages]
                              .reverse()
                              .find((m) => m && m.role !== "user" && m.role !== "tool")
                        : null
                    const assistantContent = assistantSource
                        ? normalizeMessageContent(assistantSource.content)
                        : ""
                    let finalAssistantContent = assistantContent

                    if (
                        (!finalAssistantContent ||
                            (Array.isArray(finalAssistantContent) &&
                                finalAssistantContent.length === 0)) &&
                        assistantSource &&
                        Array.isArray(assistantSource.tool_calls) &&
                        assistantSource.tool_calls.length > 0
                    ) {
                        const firstCall = assistantSource.tool_calls[0]
                        const argValue =
                            firstCall?.function?.arguments ??
                            firstCall?.arguments ??
                            firstCall?.function?.args

                        if (typeof argValue === "string" && argValue.trim().length > 0) {
                            finalAssistantContent = argValue
                        } else if (argValue != null) {
                            try {
                                finalAssistantContent = JSON.stringify(argValue, null, 2)
                            } catch {
                                finalAssistantContent = String(argValue)
                            }
                        }
                    }

                    const toolMessagesForTurn = Array.isArray(turnMessages)
                        ? turnMessages.filter((m) => m && m.role === "tool")
                        : []

                    const userNode = buildUserMessage(
                        messageSchema as any,
                        {
                            role: "user",
                            content: userContent,
                        } as any,
                    )

                    const assistantByRevision: Record<string, any> = {}
                    const toolByRevision: Record<string, any[] | null> = {}

                    const assistantNode = buildUserMessage(
                        messageSchema as any,
                        {
                            role: "assistant",
                            content: finalAssistantContent,
                        } as any,
                    )

                    if (assistantSource && Array.isArray((assistantSource as any).tool_calls)) {
                        const toolCallsArray = (assistantSource as any).tool_calls
                        ;(assistantNode as any).tool_calls = toolCallsArray
                        ;(assistantNode as any).toolCalls = {value: toolCallsArray}
                    }

                    for (const revId of revisionIds) {
                        assistantByRevision[revId] = assistantNode

                        if (toolMessagesForTurn.length > 0) {
                            toolByRevision[revId] = toolMessagesForTurn.map(
                                (toolMsg: any, idx: number) => {
                                    const contentValue = toolContentToString(toolMsg?.content)
                                    const toolName =
                                        asString(toolMsg?.name) ??
                                        asString(toolMsg?.tool_name) ??
                                        asString(toolMsg?.toolName) ??
                                        asString(toolMsg?.function?.name)
                                    const toolCallId =
                                        asString(toolMsg?.toolCallId) ??
                                        asString(toolMsg?.tool_call_id) ??
                                        asString(toolMsg?.toolCallID) ??
                                        asString(toolMsg?.id) ??
                                        asString(toolMsg?.function_call?.id)

                                    const buildFallbackNode = () => ({
                                        __id: `tool-${generateId()}`,
                                        role: {__id: `role-${generateId()}`, value: "tool"},
                                        content: {
                                            __id: `content-${generateId()}`,
                                            value: contentValue,
                                        },
                                        ...(toolName
                                            ? {
                                                  name: {
                                                      __id: `name-${generateId()}`,
                                                      value: toolName,
                                                  },
                                              }
                                            : {}),
                                        toolCallId: {
                                            __id: `toolCallId-${generateId()}`,
                                            value: toolCallId ?? "",
                                        },
                                        tool_call_id: toolCallId ?? "",
                                    })

                                    if (messageSchema) {
                                        const node = createMessageFromSchema(messageSchema as any, {
                                            role: "tool",
                                            name: toolName ?? `tool_${idx + 1}`,
                                            toolCallId: toolCallId,
                                            content: contentValue,
                                        })

                                        const existing = (node as any)?.toolCallId
                                        if (existing && typeof existing === "object") {
                                            if (
                                                existing.content &&
                                                typeof existing.content === "object"
                                            ) {
                                                existing.content.value = toolCallId ?? ""
                                            }
                                            existing.value = toolCallId ?? ""
                                        } else {
                                            ;(node as any).toolCallId = {
                                                __id: `toolCallId-${generateId()}`,
                                                value: toolCallId ?? "",
                                            }
                                        }

                                        ;(node as any).tool_call_id = toolCallId ?? ""

                                        return node
                                    }

                                    return buildFallbackNode()
                                },
                            )
                        }
                    }

                    const turnEntry: any = {
                        id: logicalId,
                        sessionId,
                        userMessage: userNode,
                        assistantMessageByRevision: assistantByRevision,
                        meta: {},
                    }

                    if (Object.keys(toolByRevision).length > 0) {
                        turnEntry.toolResponsesByRevision = toolByRevision
                    }

                    newTurnsById[logicalId] = turnEntry
                }
            }

            set(chatTurnsByIdStorageAtom, newTurnsById)
            set(chatTurnsByIdCacheAtom, {})
            set(chatTurnIdsAtom, newTurnIds)
            set(chatSessionsByIdAtom, {
                [sessionId]: {
                    id: sessionId,
                    variables: [],
                    turnIds: newTurnIds,
                    meta: {},
                },
            })
            set(chatSessionIdsAtom, [sessionId])
        }
    },
)
