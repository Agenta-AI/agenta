/**
 * createAdaptiveTracePageFetcher — build a per-page trace fetcher for the
 * scan pipelines (bulk CSV export, batch-add-to-annotation-queue) with
 * two layers of throttle awareness baked in:
 *
 *   1. **Proactive pacing**. Before each fetch (after the first), sleep
 *      for a duration computed from the previous response's
 *      `X-RateLimit-Remaining` / `X-RateLimit-Limit` headers. Floor at
 *      full bucket, ramp toward the sustained refill rate as the bucket
 *      drains. See `computeAdaptivePageDelayMs` for the math.
 *
 *   2. **Reactive retry**. Each fetch is wrapped in `withRateLimitRetry`,
 *      so any 429 that slips past the proactive pacing (parallel org
 *      traffic, missing headers, …) pauses and resumes with the server's
 *      `Retry-After` backoff instead of killing the scan. An optional
 *      callback lets the consumer surface the pause in its UI.
 *
 * Both consumers used to either duplicate this wiring (the export's
 * inline closure) or pace with an arbitrary constant (the queue scan's
 * `SCAN_PAGE_DELAY_MS = 300`). They now share one fetcher, and the
 * "right" pace per tier falls out of the live bucket signal.
 */

import {computeAdaptivePageDelayMs} from "@agenta/entities/trace/etl"

import type {TraceSpanNode} from "@/oss/services/tracing/types"
import {executeTraceQuery, type Condition} from "@/oss/state/newObservability/atoms/queryHelpers"

import {adaptiveSleep} from "./adaptiveExportPacing"
import {withRateLimitRetry} from "./withRateLimitRetry"

/** Default API page size (rows per request). */
export const DEFAULT_TRACE_PAGE_SIZE = 500

export interface AdaptiveTracePageFetcherConfig {
    /** Trace-query params already shaped by `buildTraceQueryParams`. */
    params: Record<string, any>
    appId: string
    isHasAnnotationSelected: number
    hasAnnotationConditions: Condition[]
    hasAnnotationOperator?: string
    /** Abort signal — used for adaptive sleep and retry-backoff sleep. */
    signal: AbortSignal
    /** Rows per request (default 500). */
    pageSize?: number
    /**
     * Fired before each 429-induced sleep so the consumer can surface the
     * pause in its UI. `delayMs` is the server-honored backoff duration.
     */
    onRateLimitPause?: (delayMs: number) => void
}

/** One page of matching traces; `nextCursor: null` ⇒ end of stream. */
export interface AdaptiveTracePage {
    rows: TraceSpanNode[]
    nextCursor: string | null
}

/**
 * Cursor-paged trace fetcher. `cursor: null` = first page. The `signal`
 * argument the source passes per-page is forwarded to the inner fetch as
 * its abort; the adaptive sleep / retry sleep use the signal captured at
 * construction time (in practice they're the same controller).
 */
export type AdaptiveTracePageFetcher = (
    cursor: string | null,
    signal: AbortSignal,
) => Promise<AdaptiveTracePage>

export const createAdaptiveTracePageFetcher = ({
    params,
    appId,
    isHasAnnotationSelected,
    hasAnnotationConditions,
    hasAnnotationOperator,
    signal,
    pageSize = DEFAULT_TRACE_PAGE_SIZE,
    onRateLimitPause,
}: AdaptiveTracePageFetcherConfig): AdaptiveTracePageFetcher => {
    const scanParams: Record<string, any> = {...params, size: pageSize}
    if (!scanParams.newest) {
        scanParams.newest = new Date().toISOString()
    }

    // Live bucket state from the latest successful response. The first
    // call has no reading — adaptive sleep is skipped, and any 429 falls
    // to the retry wrapper to recover.
    let lastRateLimit: {remaining: number | null; limit: number | null} = {
        remaining: null,
        limit: null,
    }
    let isFirstFetch = true

    return async (cursor, callerSignal) => {
        if (!isFirstFetch) {
            const delayMs = computeAdaptivePageDelayMs(lastRateLimit)
            await adaptiveSleep(delayMs, signal)
        }
        isFirstFetch = false

        return withRateLimitRetry(
            async () => {
                const result = await executeTraceQuery({
                    params: scanParams,
                    pageParam: cursor ? {newest: cursor} : undefined,
                    appId,
                    isHasAnnotationSelected,
                    hasAnnotationConditions,
                    hasAnnotationOperator,
                    signal: callerSignal,
                })
                lastRateLimit = result.rateLimit
                return {
                    rows: result.traces,
                    nextCursor: result.nextCursor ?? null,
                }
            },
            {
                signal,
                onRetry: (delayMs) => onRateLimitPause?.(delayMs),
            },
        )
    }
}
