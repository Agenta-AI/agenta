/**
 * UUID ↔ OpenTelemetry trace/span ID conversions.
 *
 * A UUID v4 has the layout: `xxxxxxxx-xxxx-xxxx-YYZZ-NNNNNNNNNNNN`
 *  - Trace ID = full 32 hex digits (dashes stripped)
 *  - Span ID  = YY + ZZ + N…N = last 16 hex digits (clock_seq + node)
 */

/**
 * Converts a UUID string to a 32-char hex trace ID (dashes removed).
 */
export const uuidToTraceId = (uuid?: string): string | undefined => {
    if (!uuid) return undefined
    return uuid.replace(/-/g, "")
}

/**
 * Extracts a 16-char hex span ID from a UUID
 * (clock_seq_hi_and_reserved + clock_seq_low + node fields).
 */
export const uuidToSpanId = (uuid?: string): string | undefined => {
    if (!uuid) return undefined
    const hex = uuid.replace(/-/g, "")
    // Last 16 hex chars = bytes 8–15 (clock_seq + node)
    return hex.slice(16)
}
