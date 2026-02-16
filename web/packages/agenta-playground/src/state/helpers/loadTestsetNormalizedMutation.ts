import {loadableController} from "@agenta/entities/runnable"
import type {MessageContent} from "@agenta/shared/types"
import {generateId, normalizeMessagesFromField} from "@agenta/shared/utils"
import {atom} from "jotai"

import {messageIdsAtomFamily, messagesByIdAtomFamily} from "../chat/messageAtoms"
import {clearAllMessagesAtom} from "../chat/messageReducer"
import type {ChatMessage} from "../chat/messageTypes"
import {SHARED_SESSION_ID} from "../chat/messageTypes"
import {displayedEntityIdsAtom} from "../execution/displayedEntities"
import {derivedLoadableIdAtom, isChatModeAtom} from "../execution/selectors"

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
          file: {file_id?: string; file_data?: string; name?: string; format?: string}
      }

const asObject = (input: unknown): Record<string, unknown> | null =>
    input && typeof input === "object" ? (input as Record<string, unknown>) : null

const unwrapValue = (input: unknown): unknown => {
    const visited = new Set<unknown>()
    let current: unknown = input

    while (true) {
        const obj = asObject(current)
        if (!obj || !("value" in obj)) break
        const value = obj.value
        if (value === undefined || value === current || visited.has(current)) break
        visited.add(current)
        current = value
    }

    return current
}

const asString = (raw: unknown): string | undefined => {
    const value = unwrapValue(raw)
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    return undefined
}

const buildImagePart = (raw: unknown): NormalizedContentPart | null => {
    const value = asObject(unwrapValue(raw))
    if (!value) return null

    const url = asString(value.url ?? value.uri ?? value)
    if (!url) return null

    const detail = asString(value.detail)
    return {
        type: "image_url",
        image_url: detail && detail.length > 0 ? {url, detail} : {url},
    }
}

const buildFilePart = (raw: unknown): NormalizedContentPart | null => {
    const value = asObject(unwrapValue(raw))
    if (!value) return null

    const fileId = asString(value.file_id ?? value.fileId ?? value)
    const fileData = asString(value.file_data ?? value.fileData)
    if (!fileId && !fileData) return null

    return {
        type: "file",
        file: {
            ...(fileId ? {file_id: fileId} : {}),
            ...(fileData ? {file_data: fileData} : {}),
            ...(asString(value.name) ? {name: asString(value.name)} : {}),
            ...(asString(value.format) ? {format: asString(value.format)} : {}),
        },
    }
}

const normalizeContentPart = (part: unknown): NormalizedContentPart | null => {
    const value = unwrapValue(part)
    if (value == null) return null

    const primitive = asString(value)
    if (primitive !== undefined) {
        return primitive.length > 0 ? {type: "text", text: primitive} : null
    }

    const obj = asObject(value)
    if (!obj) return null

    const explicitType = asString(obj.type)?.toLowerCase()
    if (explicitType === "image_url") {
        return buildImagePart(obj.image_url ?? obj.imageUrl)
    }
    if (explicitType === "file") {
        return buildFilePart(obj.file)
    }

    return (
        (obj.image_url || obj.imageUrl ? buildImagePart(obj.image_url ?? obj.imageUrl) : null) ??
        (obj.file ? buildFilePart(obj.file) : null) ??
        (() => {
            const textValue =
                asString(obj.text) ??
                asString(obj.content) ??
                asString(obj.message) ??
                asString(obj)
            return textValue && textValue.length > 0 ? {type: "text", text: textValue} : null
        })()
    )
}

const normalizeMessageContent = (raw: unknown): string | NormalizedContentPart[] => {
    const value = unwrapValue(raw)

    const primitive = asString(value)
    if (primitive !== undefined) return primitive

    if (Array.isArray(value)) {
        const parts = value
            .map((item) => normalizeContentPart(item))
            .filter((item): item is NormalizedContentPart => Boolean(item))
        return parts.length > 0 ? parts : ""
    }

    const obj = asObject(value)
    if (obj) {
        const nested = obj.content ?? obj.parts
        if (nested && nested !== value) {
            const normalized = normalizeMessageContent(nested)
            if (typeof normalized === "string") {
                if (normalized.length > 0) return normalized
            } else if (normalized.length > 0) {
                return normalized
            }
        }

        const single = normalizeContentPart(obj)
        if (single) return [single]
    }

    return ""
}

const toolContentToString = (raw: unknown): string => {
    const normalized = normalizeMessageContent(raw)

    if (Array.isArray(normalized)) {
        if (normalized.length === 0) return ""
        return normalized
            .map((part) => {
                if (part.type === "text") return part.text
                if (part.type === "image_url") return JSON.stringify(part.image_url)
                if (part.type === "file") return JSON.stringify(part.file)
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
 * Load testset rows into normalized package state.
 * - Completion mode: rows only.
 * - Chat mode: rows + turn history generated from `messages` fields.
 */
export const loadTestsetNormalizedMutationAtom = atom(
    null,
    (
        get,
        set,
        params: {
            testsetData: Record<string, unknown>[]
            isChatVariant?: boolean
            regenerateVariableIds?: boolean
        },
    ) => {
        const {testsetData = [], isChatVariant = get(isChatModeAtom) ?? false} = params ?? {}
        if (!Array.isArray(testsetData) || testsetData.length === 0) return

        const loadableId = get(derivedLoadableIdAtom)
        if (!loadableId) return

        const displayedIds = get(displayedEntityIdsAtom) || []
        const baseline = displayedIds[0]
        const targetEntityIds = displayedIds.length > 0 ? displayedIds : [baseline || ""]

        const dataset = Array.isArray(testsetData) ? testsetData : []

        if (isChatVariant) {
            set(clearAllMessagesAtom, {loadableId})

            const rowData = (dataset[0] || {}) as Record<string, unknown>
            const keys = Object.keys(rowData).filter((k) => !MESSAGE_FIELD_KEYS.has(k))

            const updateData: Record<string, unknown> = {}
            for (const key of keys) {
                const raw = rowData[key]
                if (raw === undefined) continue
                updateData[key] = Array.isArray(raw)
                    ? JSON.stringify(raw)
                    : typeof raw === "string"
                      ? raw
                      : String(raw ?? "")
            }

            const existingRowIds = get(loadableController.selectors.displayRowIds(loadableId))
            if (existingRowIds.length > 0) {
                set(loadableController.actions.updateRow, loadableId, existingRowIds[0], updateData)
            } else {
                set(loadableController.actions.addRow, loadableId, updateData)
            }
        } else {
            set(loadableController.actions.clearRows, loadableId)

            for (const row of dataset) {
                const rowData = (row || {}) as Record<string, unknown>
                const keys = Object.keys(rowData).filter((k) => !MESSAGE_FIELD_KEYS.has(k))
                const data: Record<string, unknown> = {}

                for (const key of keys) {
                    const raw = rowData[key]
                    if (raw === undefined) continue
                    data[key] = Array.isArray(raw)
                        ? JSON.stringify(raw)
                        : typeof raw === "string"
                          ? raw
                          : String(raw ?? "")
                }

                set(loadableController.actions.addRow, loadableId, data)
            }
        }

        if (!isChatVariant) return

        const datasetMessages = testsetData.map((row) => normalizeMessagesFromField(row.messages))
        const allMessages = datasetMessages.flat()
        if (!Array.isArray(allMessages) || allMessages.length === 0) return

        const entityIds = targetEntityIds.filter((id) => typeof id === "string" && id.length > 0)

        if (entityIds.length === 0) {
            if (baseline) entityIds.push(baseline)
            else if (targetEntityIds[0]) entityIds.push(targetEntityIds[0])
            else entityIds.push("__default__")
        }

        const flatMessageIds: string[] = []
        const flatMessagesById: Record<string, ChatMessage> = {}

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

                let nextUserIndex = -1
                for (let idx = userIndex + 1; idx < rowMessages.length; idx++) {
                    if (rowMessages[idx]?.role === "user") {
                        nextUserIndex = idx
                        break
                    }
                }

                const userMessage = rowMessages[userIndex]
                const turnMessages =
                    nextUserIndex === -1
                        ? rowMessages.slice(userIndex + 1)
                        : rowMessages.slice(userIndex + 1, nextUserIndex)
                cursor = nextUserIndex === -1 ? rowMessages.length : nextUserIndex

                const userContent = normalizeMessageContent(userMessage.content) as MessageContent
                const assistantSource = [...turnMessages]
                    .reverse()
                    .find((m) => m.role !== "user" && m.role !== "tool")
                const assistantContent = assistantSource
                    ? (normalizeMessageContent(assistantSource.content) as MessageContent)
                    : ""

                let finalAssistantContent = assistantContent
                const toolCalls = assistantSource?.tool_calls
                if (
                    (!finalAssistantContent ||
                        (Array.isArray(finalAssistantContent) &&
                            finalAssistantContent.length === 0)) &&
                    Array.isArray(toolCalls) &&
                    toolCalls.length > 0
                ) {
                    const firstCall = asObject(toolCalls[0]) || {}
                    const fn = asObject(firstCall.function)
                    const argValue = firstCall.arguments ?? fn?.arguments ?? fn?.args

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

                const toolMessagesForTurn = turnMessages.filter((m) => m.role === "tool")

                // User message → shared
                const userMsgId = `msg-${generateId()}`
                const userChatMsg: ChatMessage = {
                    id: userMsgId,
                    role: "user",
                    content: userContent,
                    sessionId: SHARED_SESSION_ID,
                }
                flatMessageIds.push(userMsgId)
                flatMessagesById[userMsgId] = userChatMsg

                // Per-session assistant + tool responses
                for (const revId of entityIds) {
                    const sessId = `sess:${revId}`

                    const aMsgId = `msg-${generateId()}`
                    const aChatMsg: ChatMessage = {
                        id: aMsgId,
                        role: assistantSource?.role ?? "assistant",
                        content: finalAssistantContent,
                        ...(assistantSource && Array.isArray(assistantSource.tool_calls)
                            ? {tool_calls: assistantSource.tool_calls}
                            : {}),
                        sessionId: sessId,
                        parentId: userMsgId,
                    }
                    flatMessageIds.push(aMsgId)
                    flatMessagesById[aMsgId] = aChatMsg

                    for (const [idx, toolMsg] of toolMessagesForTurn.entries()) {
                        const msgObj = asObject(toolMsg) || {}
                        const fn = asObject(msgObj.function)
                        const contentValue = toolContentToString(msgObj.content)
                        const toolName =
                            asString(msgObj.name) ??
                            asString(msgObj.tool_name) ??
                            asString(msgObj.toolName) ??
                            asString(fn?.name)
                        const toolCallId =
                            asString(msgObj.toolCallId) ??
                            asString(msgObj.tool_call_id) ??
                            asString(msgObj.toolCallID) ??
                            asString(msgObj.id) ??
                            asString(asObject(msgObj.function_call)?.id)

                        const tMsgId = `msg-${generateId()}`
                        const tChatMsg: ChatMessage = {
                            id: tMsgId,
                            role: "tool",
                            name: toolName ?? `tool_${idx + 1}`,
                            tool_call_id: toolCallId,
                            content: contentValue,
                            sessionId: sessId,
                            parentId: userMsgId,
                        }
                        flatMessageIds.push(tMsgId)
                        flatMessagesById[tMsgId] = tChatMsg
                    }
                }
            }
        }

        // Append a blank user message for the next input
        const blankUserMsgId = `msg-${generateId()}`
        const blankUserMsg: ChatMessage = {
            id: blankUserMsgId,
            role: "user",
            content: "",
            sessionId: SHARED_SESSION_ID,
        }
        flatMessageIds.push(blankUserMsgId)
        flatMessagesById[blankUserMsgId] = blankUserMsg

        set(messageIdsAtomFamily(loadableId), flatMessageIds)
        set(messagesByIdAtomFamily(loadableId), flatMessagesById)
    },
)
