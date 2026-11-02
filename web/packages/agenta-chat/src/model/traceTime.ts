/**
 * A time stamp from a span or a session turn, in milliseconds.
 *
 * The transcript trusts the run's own time for a turn: the client's first-seen stamp back-dates
 * to page load, which is wrong for anything restored rather than watched. The turn clock and the
 * turn timestamp read the session turn's start through this.
 */
export const parseTraceTime = (value: unknown): number | undefined => {
    // Only the two shapes a span actually carries. `new Date()` coerces anything: `true` becomes
    // 1970, an empty array becomes the epoch, and a caller cannot tell those from a real stamp.
    if (typeof value !== "string" && typeof value !== "number") return undefined
    const ms = new Date(value).getTime()
    return Number.isFinite(ms) ? ms : undefined
}
