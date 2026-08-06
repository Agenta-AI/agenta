/**
 * extractAndLoadChatMessages
 *
 * Standalone write atom that extracts the `messages` field from testcase rows,
 * normalizes them into ChatMessage objects, and writes them to the chat
 * message atoms (messageIdsAtomFamily / messagesByIdAtomFamily).
 *
 * Extracted from loadTestsetNormalizedMutationAtom so it can be reused in both:
 * - The legacy LoadTestsetButton path (via loadTestsetNormalizedMutationAtom)
 * - The new TestsetDropdown → playgroundController path
 *
 * @see loadTestsetNormalizedMutation.ts for the original implementation
 */

import type {MessageContent} from "@agenta/shared/types"
import {generateId, normalizeMessagesFromField} from "@agenta/shared/utils"
import {atom} from "jotai"

import {messageIdsAtomFamily, messagesByIdAtomFamily} from "../chat/messageAtoms"
import {clearAllMessagesAtom} from "../chat/messageReducer"
import type {ChatMessage} from "../chat/messageTypes"
import {SHARED_SESSION_ID} from "../chat/messageTypes"
import {displayedEntityIdsAtom} from "../execution/displayedEntities"

// ============================================================================
// CONTENT NORMALIZATION HELPERS
// (shared with loadTestsetNormalizedMutation.ts)
// ============================================================================

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

// ============================================================================
// EXTRACT AND LOAD CHAT MESSAGES ATOM
// ============================================================================

export interface ExtractChatMessagesParams {
    /** The loadable ID to write messages into */
    loadableId: string
    /** Testcase rows, each potentially containing a `messages` field */
    testcaseRows: Record<string, unknown>[]
    /** When true, skip appending a blank user message at the end (e.g. trace replay) */
    skipBlankMessage?: boolean
}

/**
 * Extracts the `messages` field from testcase rows, normalizes them into
 * ChatMessage objects, and writes them to the chat message atoms.
 *
 * This atom:
 * 1. Clears existing messages for the loadable
 * 2. Parses `messages` from each row via normalizeMessagesFromField
 * 3. Groups messages by user turns
 * 4. Creates shared user messages and per-session assistant/tool responses
 * 5. Appends a blank user message at the end for new input
 * 6. Writes to messageIdsAtomFamily and messagesByIdAtomFamily
 */
export const extractAndLoadChatMessagesAtom = atom(
    null,
    (get, set, params: ExtractChatMessagesParams) => {
        const {loadableId, testcaseRows, skipBlankMessage} = params

        if (!testcaseRows || testcaseRows.length === 0) return

        // Defensive single-row guard for chat. The canonical gate lives at
        // each `playgroundController` entrypoint that builds the row list
        // for a chat playground — `connectToTestsetAtom`,
        // `importTestcasesAtom`. This guard catches callers that bypass
        // that controller (URL hydration, direct atom sets in tests, future
        // entrypoints) and prevents the multi-row concatenation regression
        // Mahmoud reported on 2026-06-01: passing N rows here would
        // interleave every row's `messages` into the single shared
        // `messageIdsAtomFamily(loadableId)` queue, producing a nonsensical
        // "row1 user → row1 assistant → row2 user → row2 assistant → …"
        // thread. Take only the first row in chat; the chat UI only ever
        // displays one row (see `generationVariableRowIdsAtom`).
        const effectiveRows = testcaseRows.length > 1 ? [testcaseRows[0]] : testcaseRows

        // Clear existing messages
        set(clearAllMessagesAtom, {loadableId})

        // Resolve messages from testcase rows.
        // Testcase data can arrive in two shapes:
        // 1. Flat: { messages: [...], ... }  — from the legacy LoadTestsetButton path
        // 2. Nested: { data: { messages: [...] }, ... }  — from testcaseMolecule.get.data()
        const resolveMessages = (row: Record<string, unknown>): unknown => {
            if (row.messages !== undefined) return row.messages
            const data = row.data
            if (data && typeof data === "object" && !Array.isArray(data)) {
                return (data as Record<string, unknown>).messages
            }
            return undefined
        }

        // Parse messages from each row. After the chat single-row guard
        // above, `effectiveRows` is at most one row; we keep the
        // `datasetMessages.map(...)` structure so the loop semantics stay
        // identical in case a future change re-enables multi-row seeding.
        const datasetMessages = effectiveRows.map((row) =>
            normalizeMessagesFromField(resolveMessages(row)),
        )
        const allMessages = datasetMessages.flat()
        if (!Array.isArray(allMessages) || allMessages.length === 0) return

        // Get revision IDs for per-session assignment
        const displayedRevIds = get(displayedEntityIdsAtom) || []
        const baseline = displayedRevIds[0]
        const targetRevisionIds = displayedRevIds.length > 0 ? displayedRevIds : [baseline || ""]

        const revisionIds = targetRevisionIds.filter(
            (rev) => typeof rev === "string" && rev.length > 0,
        )

        if (revisionIds.length === 0) {
            if (baseline) revisionIds.push(baseline)
            else if (targetRevisionIds[0]) revisionIds.push(targetRevisionIds[0])
            else revisionIds.push("__default__")
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

                // Every non-user message in the turn, in original order. A turn
                // may hold more than one assistant: the assistant that calls a
                // tool, the tool result, then the assistant that replies. We
                // must keep all of them and preserve the order so the
                // assistant `tool_calls` and the tool `tool_call_id` stay paired
                // (OpenAI rejects a tool message that has no preceding assistant
                // with matching tool_calls).
                const responseMessages = turnMessages.filter((m) => m && m.role !== "user")

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

                // Per-session assistant + tool responses, in source order.
                for (const revId of revisionIds) {
                    const sessId = `sess:${revId}`
                    let toolIdx = 0

                    for (const srcMsg of responseMessages) {
                        const msgObj = asObject(srcMsg) || {}
                        const role = asString(msgObj.role) ?? "assistant"
                        const msgId = `msg-${generateId()}`

                        if (role === "tool") {
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

                            const tChatMsg: ChatMessage = {
                                id: msgId,
                                role: "tool",
                                name: toolName ?? `tool_${toolIdx + 1}`,
                                tool_call_id: toolCallId,
                                content: contentValue,
                                sessionId: sessId,
                                parentId: userMsgId,
                            }
                            toolIdx += 1
                            flatMessageIds.push(msgId)
                            flatMessagesById[msgId] = tChatMsg
                        } else {
                            // Assistant (or other non-tool role). Keep content as
                            // is, including an empty string for a pure tool-call
                            // turn, and carry tool_calls through unchanged.
                            const aChatMsg: ChatMessage = {
                                id: msgId,
                                role,
                                content: normalizeMessageContent(msgObj.content) as MessageContent,
                                ...(Array.isArray(msgObj.tool_calls)
                                    ? {tool_calls: msgObj.tool_calls}
                                    : {}),
                                sessionId: sessId,
                                parentId: userMsgId,
                            }
                            flatMessageIds.push(msgId)
                            flatMessagesById[msgId] = aChatMsg
                        }
                    }
                }
            }
        }

        // Append a blank user message for the next input (unless suppressed,
        // e.g. when replaying a trace where no new input is expected initially)
        if (!skipBlankMessage) {
            const blankUserMsgId = `msg-${generateId()}`
            const blankUserMsg: ChatMessage = {
                id: blankUserMsgId,
                role: "user",
                content: "",
                sessionId: SHARED_SESSION_ID,
            }
            flatMessageIds.push(blankUserMsgId)
            flatMessagesById[blankUserMsgId] = blankUserMsg
        }

        set(messageIdsAtomFamily(loadableId), flatMessageIds)
        set(messagesByIdAtomFamily(loadableId), flatMessagesById)
    },
)
