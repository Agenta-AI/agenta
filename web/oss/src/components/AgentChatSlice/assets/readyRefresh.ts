/**
 * The watch relay emits `ready` on EVERY connect, and it connects on every tab activation and every
 * return to a foreground window. Treating that like a records change re-read the whole ~200KB log,
 * remapped it, and replaced the transcript — so reopening a long session paid for the log twice,
 * and paid again on each refocus (#6296).
 *
 * `ready` exists to close one narrow race: a change can land after the response headers flush but
 * before the Redis subscribe completes, so it reaches neither the stream nor a revalidation driven
 * by `onopen`. A read of the log that is already newer than the connection cannot have missed that
 * change, which is why "we just read it" is a safe skip. A genuine change after subscribe arrives as
 * `records-changed`, which is never deduped.
 */

/** Matches the relay's own per-event coalescing window, so `ready` and a `records-changed` burst
 * on the same connect collapse to one read either way. */
export const READY_RELOAD_GRACE_MS = 3_000

export interface ReadyRefreshInputs {
    /** A full-log read is running right now (the mount's revalidation, a catch-up poll). */
    inFlight: boolean
    /** When the last full-log read completed; absent if none has on this mount. */
    lastLoadedAt: number | undefined
    now: number
}

/** Does this `ready` need its own read of the record log? */
export const shouldRefreshOnReady = ({
    inFlight,
    lastLoadedAt,
    now,
}: ReadyRefreshInputs): boolean => {
    if (inFlight) return false
    if (lastLoadedAt === undefined) return true
    return now - lastLoadedAt >= READY_RELOAD_GRACE_MS
}
