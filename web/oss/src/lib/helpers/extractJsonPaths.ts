/**
 * Utility functions for extracting JSON paths from objects.
 * Used by the JSON Multi-Field Match evaluator to auto-detect fields from testcase data.
 */

/**
 * Recursively extracts all leaf paths from a JSON object using dot notation.
 *
 * Example:
 * Input: {user: {name: "John", address: {city: "NYC"}}}
 * Output: ["user.name", "user.address.city"]
 *
 * @param obj - The object to extract paths from
 * @param prefix - Current path prefix (used for recursion)
 * @returns Array of dot-notation paths to all leaf values
 */
export const extractJsonPaths = (obj: unknown, prefix = ""): string[] => {
    if (obj === null || obj === undefined) return []
    if (typeof obj !== "object") return prefix ? [prefix] : []

    // For arrays, we don't expand individual indices - just mark the path
    // This keeps the UI manageable and matches common use cases
    if (Array.isArray(obj)) {
        return prefix ? [prefix] : []
    }

    const paths: string[] = []

    for (const key of Object.keys(obj as Record<string, unknown>)) {
        const newPrefix = prefix ? `${prefix}.${key}` : key
        const value = (obj as Record<string, unknown>)[key]

        if (value !== null && typeof value === "object" && !Array.isArray(value)) {
            // Recurse into nested objects
            paths.push(...extractJsonPaths(value, newPrefix))
        } else {
            // Leaf node (primitive, array, or null)
            paths.push(newPrefix)
        }
    }

    return paths
}

/**
 * Parses a JSON string and extracts all paths.
 * Returns empty array if parsing fails.
 *
 * @param jsonString - JSON string to parse and extract paths from
 * @returns Array of dot-notation paths
 */
export const extractJsonPathsFromString = (jsonString: string): string[] => {
    try {
        const parsed = JSON.parse(jsonString)
        return extractJsonPaths(parsed)
    } catch {
        return []
    }
}

/**
 * Safely parses a value that might be JSON string or already an object.
 *
 * @param value - Value to parse (string or object)
 * @returns Parsed object or null if invalid
 */
export const safeParseJson = (value: unknown): Record<string, unknown> | null => {
    if (value === null || value === undefined) return null

    if (typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>
    }

    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value)
            if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
                return parsed
            }
        } catch {
            return null
        }
    }

    return null
}
