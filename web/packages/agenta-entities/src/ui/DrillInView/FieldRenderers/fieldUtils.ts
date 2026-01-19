/**
 * Field utility functions for FieldRenderers
 *
 * Pure functions for parsing and detecting field data types.
 * These are used by both the package components and can be imported by OSS.
 */

import {tryParseAsObject, tryParseAsArray} from "@agenta/shared"

import type {DataType} from "../coreTypes"

// Re-export for backward compatibility
export {tryParseAsObject, tryParseAsArray}

/**
 * Maximum depth for recursive field expansion
 */
export const MAX_NESTED_DEPTH = 20

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
 * Get array item value as string
 */
export function getArrayItemValue(arr: unknown[], index: number): string {
    const value = arr[index]
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

/**
 * Check if a value can be expanded (is a non-array object OR an array with items)
 */
export function canExpand(value: string): boolean {
    const obj = tryParseAsObject(value)
    if (obj !== null && Object.keys(obj).length > 0) {
        return true
    }
    const arr = tryParseAsArray(value)
    if (arr !== null && arr.length > 0) {
        return true
    }
    return false
}

/**
 * Check if a single object looks like a chat message
 */
export function isChatMessageObject(item: unknown): boolean {
    if (!item || typeof item !== "object") return false
    const obj = item as Record<string, unknown>
    const hasRole =
        typeof obj.role === "string" ||
        typeof obj.sender === "string" ||
        typeof obj.author === "string"
    // Content can be present, or tool_calls for assistant messages, or function_call for legacy
    const hasContent =
        obj.content !== undefined ||
        obj.text !== undefined ||
        obj.message !== undefined ||
        Array.isArray(obj.tool_calls) ||
        obj.function_call !== undefined
    return hasRole && hasContent
}

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
 * Simple chat message interface for parsing
 */
export interface SimpleChatMessage {
    role: string
    content: string | unknown[] | null
    id?: string
    name?: string
    tool_call_id?: string
    tool_calls?: unknown[]
    function_call?: unknown
    provider_specific_fields?: Record<string, unknown>
    annotations?: unknown[]
    refusal?: string | null
}

/**
 * Parse a message object into SimpleChatMessage format
 */
function parseMessageObject(msg: Record<string, unknown>): SimpleChatMessage {
    const role = (msg.role || msg.sender || msg.author || "user") as string
    let content = msg.content ?? msg.text ?? msg.message
    if (
        content !== null &&
        content !== undefined &&
        typeof content !== "string" &&
        !Array.isArray(content)
    ) {
        content = ""
    }

    const result: SimpleChatMessage = {
        role,
        content: content as SimpleChatMessage["content"],
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

/**
 * Detect the data type of a field value
 */
export function detectDataType(value: string): DataType {
    // Empty or whitespace-only is treated as string
    if (!value || !value.trim()) return "string"

    try {
        const parsed = JSON.parse(value)

        // If it parses to a string, the underlying data is a string
        if (typeof parsed === "string") return "string"

        // Check for boolean type
        if (typeof parsed === "boolean") return "boolean"

        // Check for number type
        if (typeof parsed === "number") return "number"

        // Check if it's messages format - only arrays of messages, not single objects
        if (Array.isArray(parsed)) {
            if (parsed.length > 0 && parsed.every(isChatMessageObject)) {
                return "messages"
            }
            // Non-message array is a json-array
            return "json-array"
        }

        // null type
        if (parsed === null) return "null"

        // Single message objects are treated as json-object to show all properties
        // (provider_specific_fields, annotations, etc.)
        if (typeof parsed === "object" && parsed !== null) return "json-object"

        return "string"
    } catch {
        // Not valid JSON - it's a plain string
        return "string"
    }
}

/**
 * Check if a field can be shown in text mode (not locked to raw-only)
 */
export function canShowTextMode(value: string): boolean {
    const dataType = detectDataType(value)
    // JSON objects (non-message) can only be shown in raw mode
    return dataType !== "json-object"
}

/**
 * Get the beautified text value for text mode display
 * For strings: show the string content without outer quotes
 * For messages: handled separately by ChatMessageList
 */
export function getTextModeValue(value: string): string {
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
export function textModeToStorageValue(textValue: string, originalValue: string): string {
    const dataType = detectDataType(originalValue)
    // If original was a JSON string, wrap the new text as JSON string
    if (dataType === "string") {
        try {
            // Check if original was a JSON-encoded string
            const parsed = JSON.parse(originalValue)
            if (typeof parsed === "string") {
                // Store as JSON string
                return JSON.stringify(textValue)
            }
        } catch {
            // Original wasn't JSON, store as plain text
        }
    }
    // For plain text or other cases, store as-is
    return textValue
}

/**
 * Format values for JSON display
 * Preserves original data types - strings stay as strings, objects stay as objects.
 * This ensures the JSON editor shows the actual data format without modification.
 */
export function formatForJsonDisplay(values: Record<string, unknown>): string {
    // Use values as-is to preserve original data types
    // A string containing JSON (e.g., '{"key": "value"}') should remain a string,
    // not be parsed into an object - this preserves data integrity
    return JSON.stringify(values, null, 2)
}

/**
 * Parse JSON display back to native values (preserves objects/arrays)
 */
export function parseFromJsonDisplay(jsonStr: string): Record<string, unknown> | null {
    try {
        const parsed = JSON.parse(jsonStr)
        if (typeof parsed !== "object" || parsed === null) {
            return null
        }
        // Return native values as-is (objects, arrays, strings, numbers, booleans)
        return parsed as Record<string, unknown>
    } catch {
        return null
    }
}
