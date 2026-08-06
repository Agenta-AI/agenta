/**
 * Adaptive request pacing — choose how long to sleep before the next page
 * request based on the throttle bucket's headroom.
 *
 * The frontend can read `X-RateLimit-Remaining` / `X-RateLimit-Limit` on
 * every successful response (the backend's throttling middleware emits both
 * for any tenant scoped to a plan). This module turns that signal into a
 * delay: short when the bucket has burst capacity left, long when it's
 * drained toward the sustained refill rate.
 *
 * Bucket-aware, not tier-aware. The same logic works across free / pro /
 * business / enterprise — the server tells us how full the bucket is, we
 * don't need to know the plan.
 *
 * @packageDocumentation
 */

/**
 * Latest throttle bucket reading. `null` when the backend didn't emit the
 * corresponding header (OSS deployments without EE throttling, the very
 * first request before any header has been seen, …).
 */
export interface AdaptivePacingRateLimit {
    /** `X-RateLimit-Remaining` — tokens left in the bucket. */
    remaining: number | null
    /** `X-RateLimit-Limit` — bucket capacity. */
    limit: number | null
}

/** Floor delay (ms) when the bucket looks full or unknown. */
export const ADAPTIVE_FLOOR_DELAY_MS = 100
/**
 * Ceiling delay (ms) when the bucket is drained — paced at EE's TRACING_SLOW
 * sustained refill rate of 1 token/second (the same across free / pro /
 * business / enterprise plans), so the scan can't outrun the refill.
 */
export const ADAPTIVE_CEILING_DELAY_MS = 1_000
/**
 * Below this fill ratio the delay starts ramping up. Above it the floor
 * wins. Keeps the scan running at full speed while there's meaningful
 * burst headroom.
 */
export const ADAPTIVE_RAMP_START_FILL = 0.5

/**
 * Pick the next page-fetch delay (ms) given the latest bucket state.
 *
 * - `fill ≥ RAMP_START_FILL` → FLOOR  (run fast, burst capacity available)
 * - `0 < fill < RAMP_START_FILL` → linear ramp toward CEILING
 * - `fill ≤ 0` → CEILING  (paced at the sustained refill rate)
 * - headers unavailable → FLOOR  (the 429-retry wrapper is the safety net)
 */
export const computeAdaptivePageDelayMs = (rateLimit: AdaptivePacingRateLimit): number => {
    const {remaining, limit} = rateLimit
    if (remaining == null || limit == null || limit <= 0) return ADAPTIVE_FLOOR_DELAY_MS

    const fill = remaining / limit
    if (fill >= ADAPTIVE_RAMP_START_FILL) return ADAPTIVE_FLOOR_DELAY_MS
    if (fill <= 0) return ADAPTIVE_CEILING_DELAY_MS

    // Linear ramp from FLOOR at `fill = RAMP_START_FILL` to CEILING at `fill = 0`.
    const t = 1 - fill / ADAPTIVE_RAMP_START_FILL
    const delay =
        ADAPTIVE_FLOOR_DELAY_MS + t * (ADAPTIVE_CEILING_DELAY_MS - ADAPTIVE_FLOOR_DELAY_MS)
    return Math.round(delay)
}
