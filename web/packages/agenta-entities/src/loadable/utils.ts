/**
 * Loadable Utilities
 *
 * Path extraction and manipulation utilities for output mapping.
 */

/**
 * Extract all paths from an object for mapping selection.
 * Flattens nested objects into dot-notation paths.
 *
 * @param obj - The object to extract paths from
 * @param prefix - Current path prefix (for recursion)
 * @param maxDepth - Maximum recursion depth
 * @returns Array of dot-notation paths
 *
 * @example
 * extractPaths({ data: { outputs: { response: "hello" } } })
 * // Returns: ["data", "data.outputs", "data.outputs.response"]
 */
export function extractPaths(obj: unknown, prefix = "", maxDepth = 5): string[] {
    const paths: string[] = []

    if (maxDepth <= 0) return paths
    if (obj === null || typeof obj !== "object") return paths

    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        const path = prefix ? `${prefix}.${key}` : key
        paths.push(path)

        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
            paths.push(...extractPaths(value, path, maxDepth - 1))
        }
    }

    return paths
}

/**
 * Get value at a dot-separated path from an object.
 *
 * @param obj - The object to get value from
 * @param path - Dot-separated path (e.g., "data.outputs.response")
 * @returns The value at the path, or undefined if not found
 *
 * @example
 * getValueAtPath({ data: { outputs: { response: "hello" } } }, "data.outputs.response")
 * // Returns: "hello"
 */
export function getValueAtPath(obj: unknown, path: string): unknown {
    if (!path) return undefined

    const keys = path.split(".")
    let current: unknown = obj

    for (const key of keys) {
        if (current === null || typeof current !== "object") {
            return undefined
        }
        current = (current as Record<string, unknown>)[key]
    }

    return current
}

/**
 * Generate a unique ID for output mappings.
 */
export function createOutputMappingId(): string {
    return `output-map-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}
