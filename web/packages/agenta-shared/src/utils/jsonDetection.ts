/**
 * JSON detection utilities for checking and parsing JSON strings.
 *
 * These utilities are useful for:
 * - Detecting if a string looks like JSON (fast, heuristic-based)
 * - Validating if a string is valid JSON (slower, parse-based)
 * - Determining JSON structure (object vs array)
 * - Type guards for plain objects
 */

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Check if a value is a plain object (not array, null, or primitive).
 * This is a fundamental type guard used throughout the codebase.
 *
 * @param value - The value to check
 * @returns true if value is a plain object
 *
 * @example
 * isPlainObject({a: 1}) // true
 * isPlainObject([1, 2]) // false (is array)
 * isPlainObject(null) // false
 * isPlainObject('string') // false
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value)
}

// ============================================================================
// JSON STRING DETECTION
// ============================================================================

/**
 * Checks if a string looks like JSON (starts and ends with { } or [ ]).
 * This is a fast heuristic check that doesn't validate the JSON.
 *
 * @param str - The string to check
 * @returns true if the string looks like JSON
 *
 * @example
 * isJsonString('{"a": 1}') // true
 * isJsonString('[1, 2, 3]') // true
 * isJsonString('hello') // false
 */
export function isJsonString(str: string): boolean {
    if (typeof str !== "string") return false
    const trimmed = str.trim()
    return (
        (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))
    )
}

/**
 * Checks if a string is a valid JSON object (not array).
 * This actually parses the JSON to validate.
 *
 * @param str - The string to check
 * @returns true if the string is valid JSON and parses to an object
 *
 * @example
 * isJsonObject('{"a": 1}') // true
 * isJsonObject('[1, 2]') // false (is array)
 * isJsonObject('invalid') // false
 */
export function isJsonObject(str: string): boolean {
    return tryParseAsObject(str) !== null
}

/**
 * Checks if a string is a valid JSON array.
 * This actually parses the JSON to validate.
 *
 * @param str - The string to check
 * @returns true if the string is valid JSON and parses to an array
 *
 * @example
 * isJsonArray('[1, 2, 3]') // true
 * isJsonArray('{"a": 1}') // false (is object)
 * isJsonArray('invalid') // false
 */
export function isJsonArray(str: string): boolean {
    return tryParseAsArray(str) !== null
}

/**
 * Attempts to parse a string as JSON.
 *
 * @param str - The string to parse
 * @returns The parsed value, or null if parsing fails
 *
 * @example
 * tryParseJson('{"a": 1}') // { a: 1 }
 * tryParseJson('invalid') // null
 */
export function tryParseJson<T = unknown>(str: string): T | null {
    if (typeof str !== "string") return null
    try {
        return JSON.parse(str) as T
    } catch {
        return null
    }
}

/**
 * Try to parse a value as a plain object (not array).
 * Returns the parsed object or null if parsing fails or result is not an object.
 *
 * @param value - The string to parse
 * @returns The parsed object, or null if invalid
 *
 * @example
 * tryParseAsObject('{"a": 1}') // { a: 1 }
 * tryParseAsObject('[1, 2]') // null (is array)
 * tryParseAsObject('invalid') // null
 */
export function tryParseAsObject(value: string): Record<string, unknown> | null {
    if (!value || typeof value !== "string" || !value.trim()) return null
    try {
        const parsed = JSON.parse(value)
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>
        }
    } catch {
        // Not valid JSON
    }
    return null
}

/**
 * Try to parse a value as an array.
 * Returns the parsed array or null if parsing fails or result is not an array.
 *
 * @param value - The string to parse
 * @returns The parsed array, or null if invalid
 *
 * @example
 * tryParseAsArray('[1, 2, 3]') // [1, 2, 3]
 * tryParseAsArray('{"a": 1}') // null (is object)
 * tryParseAsArray('invalid') // null
 */
export function tryParseAsArray(value: string): unknown[] | null {
    if (!value || typeof value !== "string" || !value.trim()) return null
    try {
        const parsed = JSON.parse(value)
        if (Array.isArray(parsed)) {
            return parsed
        }
    } catch {
        // Not valid JSON
    }
    return null
}

/**
 * Checks if a value can be expanded as JSON (is a string that looks like JSON).
 * Useful for determining if a cell/field should show an "expand" button.
 *
 * @param value - Any value to check
 * @returns true if the value is a string that looks like JSON
 *
 * @example
 * canExpandAsJson('{"a": 1}') // true
 * canExpandAsJson({a: 1}) // false (already an object)
 * canExpandAsJson('hello') // false
 */
export function canExpandAsJson(value: unknown): boolean {
    return typeof value === "string" && isJsonString(value)
}

/**
 * Result type for tryParseJsonValue
 */
export interface JsonParseResult {
    /** The parsed value (or original value if not a JSON string) */
    parsed: unknown
    /** Whether the value is JSON (object/array or valid JSON string) */
    isJson: boolean
}

/**
 * Try to parse any value as JSON, returning both the result and whether it's JSON.
 * Handles objects, arrays, and JSON strings uniformly.
 *
 * @param value - Any value to check/parse
 * @returns Object with parsed value and isJson flag
 *
 * @example
 * tryParseJsonValue({a: 1}) // { parsed: {a: 1}, isJson: true }
 * tryParseJsonValue('{"a": 1}') // { parsed: {a: 1}, isJson: true }
 * tryParseJsonValue('hello') // { parsed: 'hello', isJson: false }
 * tryParseJsonValue(null) // { parsed: null, isJson: false }
 */
export function tryParseJsonValue(value: unknown): JsonParseResult {
    if (value === null || value === undefined) {
        return {parsed: value, isJson: false}
    }
    // Already an object/array
    if (typeof value === "object") {
        return {parsed: value, isJson: true}
    }
    // Try to parse string as JSON
    if (typeof value === "string" && isJsonString(value)) {
        const parsed = tryParseJson(value)
        if (parsed !== null) {
            return {parsed, isJson: true}
        }
    }
    return {parsed: value, isJson: false}
}
