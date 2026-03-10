/**
 * Chat Message Utilities
 *
 * Utility functions for working with chat message content, including
 * text extraction, content updates, and attachment management.
 */

import JSON5 from "json5"

import type {
    MessageContent,
    TextContentPart,
    ImageContentPart,
    FileContentPart,
    SimpleChatMessage,
} from "../types/chatMessage"

import {unwrapValue, resolveField, coerceString} from "./_internal/unwrap"

/**
 * Extract text content from a message content value.
 * Handles both string content and array content with text parts.
 */
export function extractTextFromContent(content: MessageContent): string {
    if (content === null || content === undefined) {
        return ""
    }
    if (typeof content === "string") {
        return content
    }
    if (Array.isArray(content)) {
        const textParts = content.filter((part): part is TextContentPart => part.type === "text")
        return textParts.map((part) => part.text).join("\n")
    }
    return ""
}

/**
 * Extract display text from a message, including tool call info if present.
 * For assistant messages with tool_calls, shows the function calls.
 * For tool messages, shows the response content.
 */
export function extractDisplayTextFromMessage(message: SimpleChatMessage): string {
    // If message has content, use it
    const contentText = extractTextFromContent(message.content ?? null)
    if (contentText) {
        return contentText
    }

    // For assistant messages with tool_calls but no content, show tool call info
    if (message.tool_calls && message.tool_calls.length > 0) {
        return message.tool_calls
            .map((tc) => `${tc.function.name}(${tc.function.arguments})`)
            .join("\n")
    }

    // For legacy function_call
    if (message.function_call) {
        return `${message.function_call.name}(${message.function_call.arguments})`
    }

    return ""
}

/**
 * Check if content has attachments (images or files)
 */
export function hasAttachments(content: MessageContent): boolean {
    if (typeof content === "string") return false
    if (!Array.isArray(content)) return false
    return content.some((part) => part.type === "image_url" || part.type === "file")
}

/**
 * Get attachment count from content
 */
export function getAttachmentInfo(content: MessageContent): {
    imageCount: number
    fileCount: number
} {
    if (typeof content === "string" || !Array.isArray(content)) {
        return {imageCount: 0, fileCount: 0}
    }
    const imageCount = content.filter((part) => part.type === "image_url").length
    const fileCount = content.filter((part) => part.type === "file").length
    return {imageCount, fileCount}
}

/**
 * Update text content while preserving attachments.
 *
 * @remarks
 * If the content array has multiple text parts, ALL text parts will be updated
 * to the same `newText` value. This treats multiple text parts as a single
 * logical text block. If you need to preserve distinct text parts, handle
 * the content array directly.
 */
export function updateTextInContent(content: MessageContent, newText: string): MessageContent {
    if (typeof content === "string") {
        return newText
    }
    if (!Array.isArray(content)) {
        return newText
    }
    // Find existing text part or create new one
    const hasTextPart = content.some((part) => part.type === "text")
    if (hasTextPart) {
        return content.map((part) => (part.type === "text" ? {...part, text: newText} : part))
    }
    // No text part, add one at the beginning
    return [{type: "text", text: newText}, ...content]
}

/**
 * Add an image attachment to message content
 */
export function addImageToContent(
    content: MessageContent,
    imageUrl: string,
    detail: "auto" | "low" | "high" = "auto",
): MessageContent {
    const newPart: ImageContentPart = {
        type: "image_url",
        image_url: {url: imageUrl, detail},
    }
    if (typeof content === "string") {
        return [{type: "text", text: content}, newPart]
    }
    if (!Array.isArray(content)) {
        return [{type: "text", text: ""}, newPart]
    }
    return [...content, newPart]
}

/**
 * Add a file attachment to message content
 */
export function addFileToContent(
    content: MessageContent,
    fileData: string,
    filename: string,
    format: string,
): MessageContent {
    // URLs are passed as file_id (remote reference), base64 data URIs as file_data (inline content)
    const isRemoteUrl = /^https?:\/\//i.test(fileData)
    const newPart: FileContentPart = {
        type: "file",
        file: isRemoteUrl ? {file_id: fileData} : {file_data: fileData, filename, format},
    }
    if (typeof content === "string") {
        return [{type: "text", text: content}, newPart]
    }
    if (!Array.isArray(content)) {
        return [{type: "text", text: ""}, newPart]
    }
    return [...content, newPart]
}

/**
 * Remove an attachment from message content by index
 */
export function removeAttachmentFromContent(
    content: MessageContent,
    attachmentIndex: number,
): MessageContent {
    if (typeof content === "string" || !Array.isArray(content)) {
        return content
    }
    // Find all non-text parts and remove the one at the given index
    let nonTextIndex = 0
    return content.filter((part) => {
        if (part.type === "text") return true
        const keep = nonTextIndex !== attachmentIndex
        nonTextIndex++
        return keep
    })
}

/**
 * Get attachments from content
 */
export function getAttachments(content: MessageContent): (ImageContentPart | FileContentPart)[] {
    if (typeof content === "string" || !Array.isArray(content)) {
        return []
    }
    return content.filter(
        (part): part is ImageContentPart | FileContentPart =>
            part.type === "image_url" || part.type === "file",
    )
}

// ============================================================================
// Message inspection utilities
// ============================================================================

/**
 * Check whether a message has meaningful content.
 * Handles string content, array content with text/image/file parts.
 */
export function messageHasContent(msg: SimpleChatMessage | null | undefined): boolean {
    if (!msg) return false
    const content = msg.content

    if (typeof content === "string") {
        return content.trim().length > 0
    }

    if (Array.isArray(content)) {
        return content.some((part) => {
            if (part.type === "text") return part.text.trim().length > 0
            if (part.type === "image_url") return Boolean(part.image_url?.url)
            if (part.type === "file") return Boolean(part.file?.file_id || part.file?.file_data)
            return false
        })
    }

    return false
}

/**
 * Check whether a message contains tool calls.
 */
export function messageHasToolCalls(msg: SimpleChatMessage | null | undefined): boolean {
    if (!msg) return false
    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) return true
    if (msg.function_call && typeof msg.function_call === "object") return true
    return false
}

// ============================================================================
// Chat parsing / normalization utilities
// ============================================================================

/**
 * Try to parse a JSON5 string into an array. Returns null if not parseable as an array.
 */
export function tryParseArrayFromString(s: string): unknown[] | null {
    try {
        const t = s.trim()
        if (!t.startsWith("[") && !t.startsWith("{")) return null
        const parsed = JSON5.parse(s)
        return Array.isArray(parsed) ? parsed : null
    } catch {
        return null
    }
}

/**
 * Normalize a single row's messages field (array or JSON string) into a
 * typed `SimpleChatMessage[]`.
 *
 * Handles both the standard OpenAI/Anthropic shape **and** the internal
 * property-object shape used by the playground (where values are wrapped in
 * `{ value: … }` objects).
 */
export function normalizeMessagesFromField(raw: unknown): SimpleChatMessage[] {
    const out: SimpleChatMessage[] = []
    if (!raw) return out

    const pushFrom = (m: Record<string, unknown>) => {
        const role = String(unwrapValue<string>(m.role) || "user").toLowerCase()

        const rc = m.content
        const content: MessageContent = Array.isArray(rc)
            ? rc
            : (unwrapValue<MessageContent>(rc) ?? (typeof rc === "string" ? rc : null))

        const toolCalls = resolveField<SimpleChatMessage["tool_calls"]>(
            m,
            "tool_calls",
            "toolCalls",
        )
        const functionCall = resolveField<SimpleChatMessage["function_call"]>(
            m,
            "function_call",
            "functionCall",
        )
        const toolCallId = coerceString(resolveField(m, "tool_call_id", "toolCallId"))
        const name = coerceString(resolveField(m, "name", "tool_name"))

        const payload: SimpleChatMessage = {role, content}
        if (toolCalls !== undefined) payload.tool_calls = toolCalls
        if (functionCall !== undefined) payload.function_call = functionCall
        if (toolCallId !== undefined) payload.tool_call_id = toolCallId
        if (name !== undefined) payload.name = name

        out.push(payload)
    }

    if (Array.isArray(raw)) {
        for (const m of raw) {
            if (m && typeof m === "object" && !Array.isArray(m)) {
                pushFrom(m as Record<string, unknown>)
            }
        }
        return out
    }
    if (typeof raw === "string") {
        try {
            const parsed = JSON5.parse(raw)
            if (Array.isArray(parsed)) {
                for (const m of parsed) {
                    if (m && typeof m === "object" && !Array.isArray(m)) {
                        pushFrom(m as Record<string, unknown>)
                    }
                }
            }
        } catch {
            // not parseable — return empty
        }
    }
    return out
}

/**
 * Derive a unified view model for rendering generation responses.
 *
 * Returns a potential `toolData` array (for ToolCallView), a `displayValue`
 * string for the editor, and an `isJSON` flag for syntax highlighting.
 */
export function deriveToolViewModelFromResult(result: unknown): {
    toolData: unknown[] | null
    isJSON: boolean
    displayValue: string
} {
    const rawData = (result as Record<string, unknown>)?.response as
        | Record<string, unknown>
        | undefined
    const dataField = rawData?.data
    const contentCandidate =
        typeof dataField === "string"
            ? dataField
            : dataField && typeof dataField === "object"
              ? ((dataField as Record<string, unknown>).content ??
                (dataField as Record<string, unknown>).data ??
                "")
              : ""

    // Tool-call candidates — check explicit tool_calls field first, then fall
    // back to parsing content/data arrays (legacy shapes).
    let arr: unknown[] | null = null
    const dataFieldRec =
        dataField && typeof dataField === "object" && !Array.isArray(dataField)
            ? (dataField as Record<string, unknown>)
            : null
    const toolCallsField = dataFieldRec?.tool_calls
    if (Array.isArray(toolCallsField) && toolCallsField.length > 0) {
        arr = toolCallsField
    }
    if (!arr && typeof contentCandidate === "string")
        arr = tryParseArrayFromString(contentCandidate)
    if (!arr && Array.isArray(contentCandidate)) arr = contentCandidate
    if (!arr && typeof dataField === "string") arr = tryParseArrayFromString(dataField)
    if (!arr && Array.isArray(dataField)) arr = dataField

    // Fallback editor content
    let isJSON = false
    let displayValue =
        typeof contentCandidate === "string" ? contentCandidate : String(contentCandidate ?? "")
    if (typeof contentCandidate === "string") {
        try {
            const parsed = JSON5.parse(contentCandidate)
            isJSON = true
            displayValue = JSON.stringify(parsed, null, 2)
        } catch {
            isJSON = false
        }
    }
    return {toolData: arr, isJSON, displayValue}
}
