/**
 * Parameter Conversion Utilities
 *
 * Shared utilities for parameter comparison and dirty checking.
 *
 * @packageDocumentation
 */

// ============================================================================
// COMPARISON HELPERS
// ============================================================================

const VOLATILE_KEYS = new Set(["__id", "__test", "__metadata", "__name"])

/**
 * Strip volatile/metadata keys for comparison.
 * Also strips null values from message objects since server data doesn't include them.
 *
 * @param value - The value to strip volatile keys from
 * @param preserveNulls - Whether to preserve null values at the top level (default: true)
 *                        Note: null values in message objects (name, toolCalls, etc.) are always stripped
 */
export function stripVolatileKeys(value: unknown, preserveNulls = true): unknown {
    if (value === null) return preserveNulls ? null : undefined
    if (value === undefined) return undefined
    if (typeof value !== "object") return value

    if (Array.isArray(value)) {
        return value.map((v) => stripVolatileKeys(v, preserveNulls))
    }

    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        // Skip all volatile/metadata keys that change between derivations
        if (VOLATILE_KEYS.has(key)) {
            continue
        }
        // Skip null values - server data doesn't include these optional fields
        // (e.g., name, toolCalls, toolCallId in message objects)
        if (val === null) {
            continue
        }
        const stripped = stripVolatileKeys(val, preserveNulls)
        if (stripped !== undefined) {
            result[key] = stripped
        }
    }
    return result
}
