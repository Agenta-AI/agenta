/**
 * Internal unwrap utility.
 *
 * Shared helper for extracting values from `{ value: X }` enhanced wrappers.
 * Used by chatMessage, chatPrompts, and valueExtraction utilities.
 *
 * @internal Not exported from the package public API.
 */

/** Unwrap a potential `{ value: X }` enhanced wrapper, returning the inner value or the input as-is. */
export function unwrapValue<T>(v: unknown): T | undefined {
    if (v && typeof v === "object" && "value" in (v as Record<string, unknown>)) {
        return (v as Record<string, unknown>).value as T
    }
    return v as T | undefined
}

/** Resolve a field that may exist under `snake_case` or `camelCase` keys, each possibly wrapped. */
export function resolveField<T>(
    m: Record<string, unknown>,
    snake: string,
    camel: string,
): T | undefined {
    return (
        (m[snake] as T) ??
        (m[camel] as T) ??
        unwrapValue<T>(m[camel]) ??
        unwrapValue<T>(m[snake]) ??
        undefined
    )
}

/** Coerce a resolved value to string, handling residual `{ value: X }` objects. */
export function coerceString(v: unknown): string | undefined {
    if (v === undefined || v === null) return undefined
    if (typeof v === "object" && v !== null && "value" in (v as Record<string, unknown>)) {
        return String((v as Record<string, unknown>).value ?? v)
    }
    return String(v)
}
