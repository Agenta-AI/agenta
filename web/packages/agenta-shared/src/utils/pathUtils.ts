/**
 * Path Utilities for Nested Data Navigation
 *
 * Pure utility functions for navigating and manipulating nested data structures.
 * These are data-agnostic and work with any data shape.
 *
 * @example
 * ```typescript
 * import { getValueAtPath, setValueAtPath, parsePath } from '@agenta/shared'
 *
 * const data = { user: { profile: { name: 'Alice' } } }
 * getValueAtPath(data, ['user', 'profile', 'name']) // 'Alice'
 *
 * const updated = setValueAtPath(data, ['user', 'profile', 'name'], 'Bob')
 * // { user: { profile: { name: 'Bob' } } }
 * ```
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Represents a path segment (string key or array index)
 */
export type PathSegment = string | number

/**
 * A path through nested data
 */
export type DataPath = PathSegment[]

/**
 * Item at a navigation level
 */
export interface PathItem {
    /** Key for this item (string key or array index) */
    key: string
    /** Display name */
    name: string
    /** The value at this path */
    value: unknown
    /** Whether this item is expandable (has children) */
    expandable: boolean
    /** Number of children (for arrays/objects) */
    childCount?: number
}

// ============================================================================
// PATH OPERATIONS
// ============================================================================

/**
 * Get a value at a path in nested data
 *
 * Handles JSON strings during traversal - if a string value is encountered
 * and there are more path segments, attempts to parse it as JSON.
 *
 * @example
 * ```typescript
 * const data = { user: { profile: { name: 'Alice' } } }
 * getValueAtPath(data, ['user', 'profile', 'name']) // 'Alice'
 *
 * // Also handles JSON strings stored in columns:
 * const testcase = { messages: '{"content": "hello"}' }
 * getValueAtPath(testcase, ['messages', 'content']) // 'hello'
 * ```
 */
export function getValueAtPath(data: unknown, path: DataPath): unknown {
    if (!data || path.length === 0) return data

    let current: unknown = data
    for (const key of path) {
        if (current === null || current === undefined) return undefined

        // Handle JSON strings - if current is a string and we have more path segments,
        // try to parse it as JSON
        if (typeof current === "string") {
            try {
                current = JSON.parse(current)
            } catch {
                // Not valid JSON, can't traverse further
                return undefined
            }
        }

        // Re-check after JSON parse since parsed value could be null
        if (current === null || current === undefined) return undefined

        if (typeof current !== "object") {
            return undefined
        }

        if (Array.isArray(current)) {
            const idx = typeof key === "number" ? key : parseInt(String(key), 10)
            if (isNaN(idx) || idx < 0 || idx >= current.length) return undefined
            current = current[idx]
        } else {
            current = (current as Record<string, unknown>)[String(key)]
        }
    }

    return current
}

/**
 * Set a value at a path in nested data (immutable)
 *
 * Handles JSON strings during traversal - if a string value is encountered
 * and there are more path segments, attempts to parse it as JSON, sets the
 * value, and re-stringifies.
 *
 * @example
 * ```typescript
 * const data = { user: { name: 'Alice' } }
 * setValueAtPath(data, ['user', 'name'], 'Bob')
 * // { user: { name: 'Bob' } }
 *
 * // Also handles JSON strings stored in columns:
 * const testcase = { messages: '{"content": "hello"}' }
 * setValueAtPath(testcase, ['messages', 'content'], 'world')
 * // { messages: '{"content": "world"}' }
 * ```
 */
export function setValueAtPath(data: unknown, path: DataPath, value: unknown): unknown {
    if (path.length === 0) return value

    const [key, ...rest] = path

    // Handle JSON strings - if data is a string and we have path segments,
    // try to parse it, set the value, and re-stringify
    if (typeof data === "string") {
        try {
            const parsed = JSON.parse(data)
            const updated = setValueAtPath(parsed, path, value)
            return JSON.stringify(updated)
        } catch {
            // Not valid JSON, treat as regular object
        }
    }

    if (Array.isArray(data)) {
        const idx = typeof key === "number" ? key : parseInt(String(key), 10)
        const newArray = [...data]
        newArray[idx] = rest.length === 0 ? value : setValueAtPath(data[idx], rest, value)
        return newArray
    }

    const obj = (data ?? {}) as Record<string, unknown>
    const strKey = String(key)

    if (rest.length === 0) {
        return {...obj, [strKey]: value}
    }

    return {...obj, [strKey]: setValueAtPath(obj[strKey], rest, value)}
}

/**
 * Delete a value at a path in nested data (immutable)
 *
 * Handles JSON strings during traversal - if a string value is encountered
 * and there are more path segments, attempts to parse it as JSON, deletes the
 * value, and re-stringifies.
 *
 * @example
 * ```typescript
 * const data = { user: { name: 'Alice', age: 30 } }
 * deleteValueAtPath(data, ['user', 'age'])
 * // { user: { name: 'Alice' } }
 * ```
 */
export function deleteValueAtPath(data: unknown, path: DataPath): unknown {
    if (!data || path.length === 0) return data

    const [key, ...rest] = path

    // Handle JSON strings - if data is a string and we have path segments,
    // try to parse it, delete the value, and re-stringify
    if (typeof data === "string") {
        try {
            const parsed = JSON.parse(data)
            const updated = deleteValueAtPath(parsed, path)
            return JSON.stringify(updated)
        } catch {
            // Not valid JSON, return as-is
            return data
        }
    }

    if (Array.isArray(data)) {
        const idx = typeof key === "number" ? key : parseInt(String(key), 10)
        if (rest.length === 0) {
            return data.filter((_, i) => i !== idx)
        }
        const newArray = [...data]
        newArray[idx] = deleteValueAtPath(data[idx], rest)
        return newArray
    }

    const obj = data as Record<string, unknown>
    const strKey = String(key)

    if (rest.length === 0) {
        const {[strKey]: _, ...remaining} = obj
        return remaining
    }

    return {...obj, [strKey]: deleteValueAtPath(obj[strKey], rest)}
}

/**
 * Check if a value at path exists
 *
 * Handles JSON strings during traversal.
 */
export function hasValueAtPath(data: unknown, path: DataPath): boolean {
    if (path.length === 0) return data !== undefined

    let value = getValueAtPath(data, path.slice(0, -1))
    const lastKey = path[path.length - 1]

    if (value === null || value === undefined) {
        return false
    }

    // Handle JSON strings
    if (typeof value === "string") {
        try {
            value = JSON.parse(value)
        } catch {
            return false
        }
    }

    if (value === null || typeof value !== "object") {
        return false
    }

    if (Array.isArray(value)) {
        const idx = typeof lastKey === "number" ? lastKey : parseInt(String(lastKey), 10)
        return idx >= 0 && idx < value.length
    }

    return String(lastKey) in value
}

// ============================================================================
// INSPECTION UTILITIES
// ============================================================================

/**
 * Check if a value is expandable (can be navigated into)
 */
export function isExpandable(value: unknown): boolean {
    if (value === null || value === undefined) return false

    // Check if it's a JSON string that can be parsed
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value)
            return typeof parsed === "object" && parsed !== null
        } catch {
            return false
        }
    }

    return typeof value === "object"
}

/**
 * Get the type of a value for display
 */
export function getValueType(
    value: unknown,
): "string" | "number" | "boolean" | "null" | "array" | "object" | "undefined" {
    if (value === null) return "null"
    if (value === undefined) return "undefined"
    if (Array.isArray(value)) return "array"
    return typeof value as "string" | "number" | "boolean" | "object"
}

/**
 * Get the count of children in a value
 */
export function getChildCount(value: unknown): number {
    if (value === null || value === undefined) return 0

    // Handle JSON strings
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value)
            if (Array.isArray(parsed)) return parsed.length
            if (typeof parsed === "object" && parsed !== null) {
                return Object.keys(parsed).length
            }
        } catch {
            return 0
        }
    }

    if (Array.isArray(value)) return value.length
    if (typeof value === "object") return Object.keys(value).length

    return 0
}

/**
 * Get items at a path for navigation
 */
export function getItemsAtPath(data: unknown, path: DataPath): PathItem[] {
    const value = getValueAtPath(data, path)

    if (value === null || value === undefined) return []

    // Handle JSON strings
    let parsedValue = value
    if (typeof value === "string") {
        try {
            parsedValue = JSON.parse(value)
        } catch {
            return []
        }
    }

    if (typeof parsedValue !== "object") return []

    if (Array.isArray(parsedValue)) {
        return parsedValue.map((item, index) => ({
            key: String(index),
            name: `[${index}]`,
            value: item,
            expandable: isExpandable(item),
            childCount: getChildCount(item),
        }))
    }

    return Object.entries(parsedValue as Record<string, unknown>).map(([key, itemValue]) => ({
        key,
        name: key,
        value: itemValue,
        expandable: isExpandable(itemValue),
        childCount: getChildCount(itemValue),
    }))
}

// ============================================================================
// PATH UTILITIES
// ============================================================================

/**
 * Parse a path string into segments
 *
 * @example
 * ```typescript
 * parsePath('user.profile.name') // ['user', 'profile', 'name']
 * parsePath('items[0].name') // ['items', '0', 'name']
 * ```
 */
export function parsePath(path: string | DataPath): DataPath {
    if (Array.isArray(path)) return path
    if (!path) return []

    // Handle dot notation and bracket notation
    return path
        .replace(/\[(\d+)\]/g, ".$1") // Convert brackets to dots
        .split(".")
        .filter(Boolean)
}

/**
 * Get a value at a string path (convenience wrapper for getValueAtPath + parsePath)
 *
 * This is a common pattern when working with dot-notation paths like "user.profile.name"
 * instead of array paths like ['user', 'profile', 'name'].
 *
 * @example
 * ```typescript
 * const data = { user: { profile: { name: 'Alice' } } }
 * getValueAtStringPath(data, 'user.profile.name') // 'Alice'
 * getValueAtStringPath(data, 'user.profile') // { name: 'Alice' }
 * ```
 */
export function getValueAtStringPath(data: unknown, path: string): unknown {
    return getValueAtPath(data, parsePath(path))
}

/**
 * Convert path segments to a string
 */
export function pathToString(path: DataPath): string {
    return path
        .map((segment, index) => {
            const str = String(segment)
            // Use bracket notation for numeric segments
            if (/^\d+$/.test(str)) {
                return `[${str}]`
            }
            // Use dot notation for string segments
            return index === 0 ? str : `.${str}`
        })
        .join("")
}

/**
 * Get the parent path
 */
export function getParentPath(path: DataPath): DataPath {
    return path.slice(0, -1)
}

/**
 * Get the last segment of a path
 */
export function getLastSegment(path: DataPath): PathSegment | undefined {
    return path[path.length - 1]
}

/**
 * Check if one path is a child of another
 */
export function isChildPath(parent: DataPath, child: DataPath): boolean {
    if (child.length <= parent.length) return false
    return parent.every((segment, i) => String(segment) === String(child[i]))
}

/**
 * Collect all paths in a data structure
 */
export function collectPaths(data: unknown, maxDepth = 10, currentPath: DataPath = []): DataPath[] {
    if (maxDepth <= 0) return [currentPath]

    const paths: DataPath[] = [currentPath]

    if (data === null || data === undefined || typeof data !== "object") {
        return paths
    }

    // Handle arrays
    if (Array.isArray(data)) {
        data.forEach((item, index) => {
            paths.push(...collectPaths(item, maxDepth - 1, [...currentPath, index]))
        })
        return paths
    }

    // Handle objects
    Object.entries(data).forEach(([key, value]) => {
        paths.push(...collectPaths(value, maxDepth - 1, [...currentPath, key]))
    })

    return paths
}
