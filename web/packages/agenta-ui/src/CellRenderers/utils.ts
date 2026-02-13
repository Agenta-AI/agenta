/**
 * Shared utility functions for cell content rendering
 */

import {DEFAULT_MAX_LINES, MAX_CELL_CHARS} from "./constants"

/**
 * Truncate string to first N lines for cell preview
 */
export const truncateToLines = (str: string, maxLines: number = DEFAULT_MAX_LINES): string => {
    const lines = str.split("\n")
    if (lines.length <= maxLines) return str
    return lines.slice(0, maxLines).join("\n") + "\n..."
}

/**
 * Truncate string to max characters for cell preview
 * This is critical for performance - prevents rendering huge text blocks
 */
export const truncateToChars = (str: string, maxChars: number = MAX_CELL_CHARS): string => {
    if (str.length <= maxChars) return str
    return str.slice(0, maxChars) + "..."
}

/**
 * Apply both line and character truncation
 */
export const truncateContent = (
    str: string,
    maxLines: number = DEFAULT_MAX_LINES,
    maxChars: number = MAX_CELL_CHARS,
): string => {
    const linesTruncated = truncateToLines(str, maxLines)
    return truncateToChars(linesTruncated, maxChars)
}

/**
 * Safely stringify a value to JSON
 */
export const safeJsonStringify = (value: unknown): string => {
    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value)
    }
}

/**
 * Try to parse a JSON string, returns the parsed value and whether it's JSON.
 * Re-exported from @agenta/shared for convenience.
 */
export {tryParseJsonValue as tryParseJson} from "@agenta/shared/utils"

/**
 * Normalize value to display string
 */
export const normalizeValue = (value: unknown): string => {
    if (value === null || value === undefined) return "—"
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value)
    }
    return safeJsonStringify(value)
}

/**
 * Check if a single entry looks like a chat message
 */
const isChatEntry = (entry: unknown): boolean => {
    if (!entry || typeof entry !== "object") return false
    const obj = entry as Record<string, unknown>

    const hasRole =
        typeof obj.role === "string" ||
        typeof obj.sender === "string" ||
        typeof obj.author === "string"

    if (!hasRole) return false

    // Check for content in various formats
    return (
        obj.content !== undefined ||
        obj.text !== undefined ||
        obj.message !== undefined ||
        Array.isArray(obj.content) ||
        Array.isArray(obj.parts) ||
        Array.isArray(obj.tool_calls) ||
        typeof (obj.delta as Record<string, unknown>)?.content === "string"
    )
}

/**
 * Check if a value looks like chat messages (array with role/content structure)
 */
export const isChatMessagesArray = (value: unknown): boolean => {
    if (!Array.isArray(value)) return false
    if (value.length === 0) return false

    // Check if at least one item looks like a chat message
    return value.some(isChatEntry)
}

/**
 * Extract chat messages array from various formats
 */
const CHAT_ARRAY_KEYS = [
    "messages",
    "message_history",
    "history",
    "chat",
    "conversation",
    "logs",
    "responses",
    "output_messages",
]

export const extractChatMessages = (value: unknown): unknown[] | null => {
    if (!value) return null

    // Direct array - check if it looks like chat messages
    if (Array.isArray(value)) {
        // Return array if it has chat-like entries
        if (isChatMessagesArray(value)) {
            return value
        }
        return null
    }

    if (typeof value !== "object") return null

    // Object with known chat array keys - less strict, just check if array exists
    for (const key of CHAT_ARRAY_KEYS) {
        const arr = (value as Record<string, unknown>)[key]
        if (Array.isArray(arr)) {
            return arr
        }
    }

    // OpenAI choices format
    const choices = (value as Record<string, unknown>).choices
    if (Array.isArray(choices)) {
        const messages = choices
            .map((choice: unknown) => {
                const c = choice as Record<string, unknown> | null
                return c?.message || c?.delta
            })
            .filter(Boolean)
        if (messages.length) {
            return messages
        }
    }

    // Single message object - check if it looks like a chat entry
    if (isChatMessagesArray([value])) {
        return [value]
    }

    return null
}

/**
 * Normalize chat messages to consistent format
 */
export interface NormalizedChatMessage {
    role: string
    content: unknown
    tool_calls?: unknown[]
}

export const normalizeChatMessages = (messages: unknown[]): NormalizedChatMessage[] => {
    const result: NormalizedChatMessage[] = []

    for (const entry of messages) {
        if (!entry) continue

        if (typeof entry === "string") {
            result.push({role: "assistant", content: entry})
            continue
        }

        if (typeof entry !== "object") continue

        const obj = entry as Record<string, unknown>
        const role =
            (typeof obj.role === "string" && obj.role) ||
            (typeof obj.sender === "string" && obj.sender) ||
            (typeof obj.author === "string" && obj.author) ||
            "assistant"

        const content =
            obj.content ??
            obj.text ??
            obj.message ??
            (obj.delta as Record<string, unknown>)?.content ??
            obj.response ??
            (Array.isArray(obj.parts) ? obj.parts : undefined)

        const toolCalls = Array.isArray(obj.tool_calls) ? obj.tool_calls : undefined

        if (content === undefined && !toolCalls) {
            continue
        }

        result.push({role, content, tool_calls: toolCalls})
    }

    return result
}
