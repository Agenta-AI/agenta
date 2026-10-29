/**
 * Field utility functions for FieldRenderers
 *
 * Pure functions for parsing and detecting field data types.
 * These are used by both the package components and can be imported by OSS.
 */

import type {SimpleChatMessage, MessageContent} from "@agenta/shared/types"
import {isChatMessageObject} from "@agenta/shared/utils"

import type {DataType} from "../coreTypes"

/**
 * Get nested value from an object by key
 */
export function getNestedValue(obj: Record<string, unknown>, key: string): string {
    const value = obj[key]
    if (value === null || value === undefined) return ""
    if (typeof value === "string") return value
    return JSON.stringify(value, null, 2)
}

/**
 * Check if a value can be expanded (is a non-array object with keys)
 */
export function canExpandValue(value: unknown): boolean {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return Object.keys(value).length > 0
    }
    return false
}

/**
 * Check if a value can be expanded as an array
 */
export function canExpandAsArray(value: unknown): boolean {
    return Array.isArray(value) && value.length > 0
}

export {isChatMessageObject} from "@agenta/shared/utils"

/**
 * Check if a value is an array of messages (not a single object)
 */
export function isMessagesArray(value: string): boolean {
    try {
        const parsed = JSON.parse(value)
        return Array.isArray(parsed) && parsed.length > 0 && parsed.every(isChatMessageObject)
    } catch {
        return false
    }
}

/**
 * Parse a message object into SimpleChatMessage format
 */
function parseMessageObject(msg: Record<string, unknown>): SimpleChatMessage {
    const role = (msg.role || msg.sender || msg.author || "user") as string
    let content: MessageContent | undefined = undefined

    const rawContent = msg.content ?? msg.text ?? msg.message
    if (rawContent !== null && rawContent !== undefined) {
        if (typeof rawContent === "string") {
            content = rawContent
        } else if (Array.isArray(rawContent)) {
            // Cast array content to MessageContentPart[] - the shared type handles this
            content = rawContent as MessageContent
        }
        // For non-string, non-array values, leave content undefined
    } else if (rawContent === null) {
        content = null
    }

    const result: SimpleChatMessage = {
        role,
        content,
        id: msg.id as string | undefined,
    }

    if (msg.name) result.name = msg.name as string
    if (msg.tool_call_id) result.tool_call_id = msg.tool_call_id as string
    if (msg.tool_calls) result.tool_calls = msg.tool_calls as SimpleChatMessage["tool_calls"]
    if (msg.function_call)
        result.function_call = msg.function_call as SimpleChatMessage["function_call"]
    if (msg.provider_specific_fields)
        result.provider_specific_fields = msg.provider_specific_fields as Record<string, unknown>
    if (msg.annotations) result.annotations = msg.annotations as unknown[]
    if (msg.refusal !== undefined) result.refusal = msg.refusal as string | null

    return result
}

/**
 * Parse a string value into an array of SimpleChatMessage
 */
export function parseMessages(value: string): SimpleChatMessage[] {
    try {
        const parsed = JSON.parse(value)
        if (Array.isArray(parsed)) {
            return parsed.map(parseMessageObject)
        }
        if (isChatMessageObject(parsed)) {
            return [parseMessageObject(parsed as Record<string, unknown>)]
        }
        return []
    } catch {
        return []
    }
}

function detectParsedDataType(parsed: unknown): DataType {
    if (typeof parsed === "string") return "string"
    if (typeof parsed === "boolean") return "boolean"
    if (typeof parsed === "number") return "number"
    if (Array.isArray(parsed)) {
        if (parsed.length > 0 && parsed.every(isChatMessageObject)) {
            return "messages"
        }
        return "json-array"
    }
    if (parsed === null) return "null"
    if (typeof parsed === "object") {
        // Single chat message objects (e.g. an LLM `outputs` field with one
        // assistant reply) should render through the messages widget too —
        // parseMessages already wraps them into a one-item array.
        if (isChatMessageObject(parsed)) return "messages"
        return "json-object"
    }
    return "string"
}

/**
 * Detect the data type of a native field value. In legacy string mode, callers
 * can opt into parsing the JSON-encoded storage string.
 */
export function detectDataType(
    value: unknown,
    valueMode: "native" | "string" = "native",
): DataType {
    if (valueMode === "string") {
        if (typeof value !== "string" || !value.trim()) return "string"
        try {
            return detectParsedDataType(JSON.parse(value))
        } catch {
            return "string"
        }
    }

    if (value === null) return "null"
    if (Array.isArray(value)) return detectParsedDataType(value)
    if (typeof value === "object") {
        if (isChatMessageObject(value)) return "messages"
        return "json-object"
    }
    if (typeof value === "boolean") return "boolean"
    if (typeof value === "number") return "number"
    return "string"
}

/**
 * Get the pretty text value for text mode display
 * For strings: show the string content without outer quotes
 * For messages: handled separately by ChatMessageList
 */
export function getTextModeValue(value: string, valueMode: "native" | "string" = "native"): string {
    if (valueMode === "native") return value

    try {
        const parsed = JSON.parse(value)
        // If it's a string, return the parsed string (removes outer quotes)
        if (typeof parsed === "string") return parsed
        // For other types, return as-is (will be handled by specific renderers)
        return value
    } catch {
        // Not valid JSON - return as-is
        return value
    }
}

/**
 * Convert text mode input back to storage format
 * In text mode, user enters plain text which gets stored as a JSON string
 */
export function textModeToStorageValue(
    textValue: string,
    originalValue: string,
    valueMode: "native" | "string" = "native",
): string {
    if (valueMode === "string" && detectDataType(originalValue, valueMode) === "string") {
        return JSON.stringify(textValue)
    }

    return textValue
}
