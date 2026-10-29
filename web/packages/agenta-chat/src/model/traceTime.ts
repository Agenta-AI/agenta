/**
 * When a run began, read off its trace root span.
 *
 * The trace is what the transcript trusts for a turn's time: the client's own first-seen stamp
 * back-dates to page load, which is wrong for anything restored rather than watched. Both the
 * turn timestamp and the turn clock read the same span through this.
 */
export const parseTraceTime = (value: unknown): number | undefined => {
    // Only the two shapes a span actually carries. `new Date()` coerces anything: `true` becomes
    // 1970, an empty array becomes the epoch, and a caller cannot tell those from a real stamp.
    if (typeof value !== "string" && typeof value !== "number") return undefined
    const ms = new Date(value).getTime()
    return Number.isFinite(ms) ? ms : undefined
}
