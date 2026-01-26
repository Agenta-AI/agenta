/**
 * Editor Language Detection Utilities
 *
 * Utilities for detecting the appropriate language/mode for code editors
 * based on content analysis.
 *
 * @example
 * ```typescript
 * import {detectEditorLanguage, getContentLanguage} from '@agenta/shared'
 *
 * // Detect from value (any type)
 * const lang = detectEditorLanguage({key: "value"}) // "json"
 * const lang2 = detectEditorLanguage('{"key": "value"}') // "json"
 *
 * // Detect from string content only
 * const lang3 = getContentLanguage('key: value') // "yaml"
 * ```
 */

import {isJsonString} from "./jsonDetection"

/**
 * Editor language types supported
 */
export type EditorLanguage = "json" | "yaml" | "text" | "markdown" | "code"

/**
 * Detects the appropriate editor language for a given value.
 *
 * Detection logic:
 * - Objects/arrays → json
 * - Strings that look like JSON → json
 * - Strings with YAML-like structure → yaml
 * - All other cases → text
 *
 * @param value - Any value to analyze
 * @returns The detected editor language
 *
 * @example
 * detectEditorLanguage({key: "value"}) // "json"
 * detectEditorLanguage([1, 2, 3]) // "json"
 * detectEditorLanguage('{"key": "value"}') // "json"
 * detectEditorLanguage("key: value") // "yaml" (if has YAML structure)
 * detectEditorLanguage("hello world") // "text"
 */
export function detectEditorLanguage(value: unknown): EditorLanguage {
    // Objects and arrays are always JSON
    if (value !== null && typeof value === "object") {
        return "json"
    }

    // Analyze string content
    if (typeof value === "string") {
        return getContentLanguage(value)
    }

    // Default for primitives
    return "text"
}

/**
 * Detects language from string content only.
 *
 * This is useful when you already have string content and want to
 * determine the best syntax highlighting mode.
 *
 * @param content - String content to analyze
 * @returns "json" | "yaml" | "text"
 *
 * @example
 * getContentLanguage('{"key": "value"}') // "json"
 * getContentLanguage('key: value\nother: thing') // "yaml"
 * getContentLanguage('hello world') // "text"
 */
export function getContentLanguage(content: string): "json" | "yaml" | "text" {
    const trimmed = content.trim()

    if (!trimmed) {
        return "text"
    }

    // Check for JSON structure first (brackets or braces)
    if (isJsonString(trimmed)) {
        return "json"
    }

    // Check for YAML-like structure
    // YAML typically has key: value patterns without JSON brackets
    if (trimmed.includes(":") && !trimmed.startsWith("{") && !trimmed.startsWith("[")) {
        // Simple heuristic: contains colon with space after (key: value pattern)
        if (/^\s*[\w-]+\s*:\s/m.test(trimmed)) {
            return "yaml"
        }
    }

    return "text"
}

/**
 * Checks if a string looks like it contains JSON.
 * This is a quick heuristic check that doesn't validate.
 *
 * @param str - String to check
 * @returns true if the string looks like JSON
 *
 * @example
 * looksLikeJson('{"key": "value"}') // true
 * looksLikeJson('[1, 2, 3]') // true
 * looksLikeJson('hello') // false
 *
 * @deprecated Use `isJsonString` from jsonDetection instead. This is an alias for backward compatibility.
 */
export const looksLikeJson = isJsonString
