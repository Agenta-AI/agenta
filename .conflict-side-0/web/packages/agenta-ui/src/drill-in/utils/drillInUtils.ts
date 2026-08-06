/**
 * Utility functions for DrillIn components
 *
 * Pure functions with no external dependencies - safe to use in both package and OSS.
 */

import {isChatMessageObject} from "@agenta/shared/utils"

import type {DataType, PropertyType} from "../coreTypes"

/**
 * Get default value for a given property type
 */
export function getDefaultValue(type: PropertyType): unknown {
    switch (type) {
        case "string":
            return ""
        case "number":
            return 0
        case "boolean":
            return false
        case "object":
            return {}
        case "array":
            return []
        default:
            return ""
    }
}

/**
 * Convert property type to data type for field rendering
 */
export function propertyTypeToDataType(propType: PropertyType): DataType {
    switch (propType) {
        case "string":
            return "string"
        case "number":
            return "number"
        case "boolean":
            return "boolean"
        case "object":
            return "json-object"
        case "array":
            return "json-array"
        default:
            return "string"
    }
}

/**
 * Check if a value is expandable (can be drilled into)
 */
export function isExpandable(value: unknown): boolean {
    if (value === null || value === undefined) return false

    if (typeof value === "string") return false

    if (Array.isArray(value)) return value.length > 0
    return typeof value === "object" && value !== null && Object.keys(value).length > 0
}

/**
 * Get the count of items in a value (for arrays/objects)
 */
export function getItemCount(value: unknown): number {
    if (value === null || value === undefined) return 0

    if (typeof value === "string") return 0

    if (Array.isArray(value)) return value.length
    if (typeof value === "object") return Object.keys(value).length

    return 0
}

/**
 * Parse a path string into an array of path segments
 */
export function parsePath(path: string | string[], rootTitle?: string): string[] {
    if (!path) return []
    const pathArray = typeof path === "string" ? path.split(".") : path
    // Remove the rootTitle prefix if present
    const startIndex = rootTitle && pathArray[0] === rootTitle ? 1 : 0
    return pathArray.slice(startIndex)
}

/**
 * Convert path array to typed path (numbers for array indices)
 */
export function toTypedPath(path: string[]): (string | number)[] {
    return path.map((segment) => {
        const asNumber = parseInt(segment, 10)
        return !isNaN(asNumber) ? asNumber : segment
    })
}

/**
 * Format a segment for human-readable display
 */
export function formatSegment(segment: string, parentSegment?: string): string {
    // Check if this is a numeric index
    const numericIndex = parseInt(segment, 10)
    if (!isNaN(numericIndex) && String(numericIndex) === segment) {
        // Get singular name from parent key
        const parentKey = parentSegment || ""
        const singularName = parentKey.endsWith("s") ? parentKey.slice(0, -1) : parentKey || "Item"
        // Capitalize first letter
        const displayName = singularName.charAt(0).toUpperCase() + singularName.slice(1)
        return `${displayName} ${numericIndex + 1}`
    }
    return segment
}

/**
 * Generate a unique key for a field based on its path
 */
export function generateFieldKey(fullPath: string[]): string {
    return fullPath.join("-")
}

/**
 * Format a property key as a human-readable label.
 * Converts snake_case and camelCase to Title Case.
 *
 * @example
 * formatLabel("max_tokens") // "Max Tokens"
 * formatLabel("topP") // "Top P"
 * formatLabel("model") // "Model"
 */
export function formatLabel(key: string): string {
    return key
        .replace(/_/g, " ")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .split(" ")
        .map((word) => {
            if (word === word.toUpperCase()) return word
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        })
        .join(" ")
}

/**
 * Determines if a data type supports raw mode toggle.
 * Raw mode shows the stringified JSON representation instead of a formatted/specialized view.
 *
 * Data types that support raw mode:
 * - string: Can toggle between text editor and JSON string view
 * - messages: Can toggle between chat message list and raw JSON
 * - json-object: Can toggle between formatted JSON and raw stringified view
 * - json-array: Can toggle between formatted JSON and raw stringified view
 * - boolean: Can toggle between switch and JSON primitive view
 * - number: Can toggle between number input and JSON primitive view
 */
export function canToggleRawMode(dataType: DataType): boolean {
    return (
        dataType === "string" ||
        dataType === "messages" ||
        dataType === "json-object" ||
        dataType === "json-array" ||
        dataType === "boolean" ||
        dataType === "number"
    )
}

function detectParsedDataType(parsed: unknown): DataType {
    if (parsed === null) return "null"
    if (Array.isArray(parsed)) {
        if (parsed.length > 0 && parsed.every(isChatMessageObject)) {
            return "messages"
        }
        return "json-array"
    }
    if (typeof parsed === "object") {
        // Detect a single chat message object (e.g. an LLM `outputs` field
        // with one assistant reply) so it renders through the messages widget
        // instead of as raw JSON. parseMessages already wraps single objects.
        if (isChatMessageObject(parsed)) return "messages"
        return "json-object"
    }
    if (typeof parsed === "boolean") return "boolean"
    if (typeof parsed === "number") return "number"
    return "string"
}

/**
 * Detect the data type from a native value. In legacy string mode, callers can
 * opt into parsing the JSON-encoded storage string.
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
