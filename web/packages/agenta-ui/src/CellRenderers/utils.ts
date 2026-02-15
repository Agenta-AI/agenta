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
export type ChatExtractionPreference = "input" | "output"

interface ExtractChatMessagesOptions {
    prefer?: ChatExtractionPreference
}

const INPUT_KEYS = ["prompt", "input_messages"]
const OUTPUT_KEYS = ["completion", "output_messages", "responses"]
const NEUTRAL_KEYS = ["messages", "message_history", "history", "chat", "conversation", "logs"]

const getOrderedKeys = (prefer?: ChatExtractionPreference): string[] => {
    if (prefer === "input") {
        return [...INPUT_KEYS, ...NEUTRAL_KEYS, ...OUTPUT_KEYS]
    }
    if (prefer === "output") {
        return [...OUTPUT_KEYS, ...NEUTRAL_KEYS, ...INPUT_KEYS]
    }
    return [...NEUTRAL_KEYS, ...INPUT_KEYS, ...OUTPUT_KEYS]
}

const getOrderedWrappers = (
    obj: Record<string, unknown>,
    prefer?: ChatExtractionPreference,
): unknown[] => {
    const data =
        obj.data && typeof obj.data === "object" && !Array.isArray(obj.data)
            ? (obj.data as Record<string, unknown>)
            : undefined

    const inputFirst = [
        obj.inputs,
        data?.inputs,
        obj.request,
        obj.data,
        obj.outputs,
        data?.outputs,
        obj.response,
    ]

    const outputFirst = [
        obj.outputs,
        data?.outputs,
        obj.response,
        obj.data,
        obj.inputs,
        data?.inputs,
        obj.request,
    ]

    const neutral = [
        obj.data,
        obj.inputs,
        obj.outputs,
        data?.inputs,
        data?.outputs,
        obj.request,
        obj.response,
    ]

    if (prefer === "input") return inputFirst
    if (prefer === "output") return outputFirst
    return neutral
}

export const extractChatMessages = (
    value: unknown,
    options?: ExtractChatMessagesOptions,
    depth = 0,
    seen: WeakSet<object> = new WeakSet(),
): unknown[] | null => {
    if (depth > 3) return null
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

    const obj = value as Record<string, unknown>

    if (seen.has(obj)) return null
    seen.add(obj)

    const orderedKeys = getOrderedKeys(options?.prefer)

    // Object with known chat array keys - validate shape before accepting
    for (const key of orderedKeys) {
        const arr = obj[key]
        if (Array.isArray(arr) && isChatMessagesArray(arr)) {
            return arr
        }
    }

    // Common wrappers used by tracing payloads
    // e.g. {inputs: {prompt: [...]}} or {data: {outputs: {completion: [...]}}}
    const nestedCandidates = getOrderedWrappers(obj, options?.prefer)

    for (const candidate of nestedCandidates) {
        const nested = extractChatMessages(candidate, options, depth + 1, seen)
        if (nested) {
            return nested
        }
    }

    // OpenAI choices format
    const choices = obj.choices
    if (Array.isArray(choices)) {
        const messages = choices
            .map((choice: unknown) => {
                const c = choice as Record<string, unknown> | null
                return c?.message || c?.delta
            })
            .filter(Boolean)
        if (messages.length && isChatMessagesArray(messages)) {
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
