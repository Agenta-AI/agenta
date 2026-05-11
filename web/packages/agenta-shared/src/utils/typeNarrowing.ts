/**
 * Type Narrowing Utilities
 *
 * Pure helper functions for safe type narrowing of unknown values.
 * These are used across multiple packages to avoid duplicating
 * the same safe-cast patterns.
 */

/**
 * Safely narrow an unknown value to a plain object record.
 * Returns `null` for arrays, primitives, and nullish values.
 */
export function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    return value as Record<string, unknown>
}

/**
 * Safely stringify a value to JSON with pretty-printing.
 * Returns `String(value)` when JSON serialization fails.
 */
export function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value ?? "")
    }
}
