/**
 * Cache-aware bulk-prefetch for traces.
 *
 * Composes two layers:
 *
 *   1. **TanStack Query cache** at `["trace-entity", projectId, traceId]`,
 *      reused with `traceEntityAtomFamily(traceId)` so a trace already viewed
 *      by the user doesn't get refetched here.
 *
 *   2. **`traceBatchFetcher`** (in ./store) which uses `createBatchFetcher`
 *      to coalesce concurrent single-trace requests into one bulk
 *      `/tracing/spans/query` call with `trace_id IN [...]`.
 *
 * Flow per call:
 *   1. Read each requested traceId from TanStack cache.
 *   2. For misses, fire `traceBatchFetcher({projectId, traceId})` per missing id.
 *      The batch fetcher coalesces them into one network round-trip.
 *   3. Write the resulting envelopes back to the cache so future readers
 *      (including React subscribers via `traceEntityAtomFamily`) see them.
 *
 * The bulk fetcher uses dashed/canonical IDs as the network key but the
 * cache stores entries by **dashed** trace_id. This action takes dashed IDs
 * (as they appear in `result.trace_id`) and returns a Map keyed by dashed
 * trace_id — caller-friendly.
 *
 * @packageDocumentation
 */

import {getDefaultStore} from "jotai/vanilla"
import {queryClientAtom} from "jotai-tanstack-query"

import {fetchAllPreviewTraces} from "../api"
import type {TracesApiResponse} from "../core"

function cacheKey(projectId: string, traceId: string) {
    return ["trace-entity", projectId, traceId] as const
}

function getQc() {
    return getDefaultStore().get(queryClientAtom)
}

export interface PrefetchTracesArgs {
    projectId: string
    /** Dashed trace_ids as they appear in `result.trace_id`. */
    traceIds: string[]
}

export interface PrefetchTracesOutcome {
    /** Trace envelopes keyed by dashed trace_id. */
    traces: Map<string, TracesApiResponse>
    cacheHits: number
    cacheMisses: number
    /** Wall-clock for the batch fetch (single network round trip thanks to coalescing). */
    fetchMs: number
}

export async function prefetchTracesByIds(
    args: PrefetchTracesArgs,
): Promise<PrefetchTracesOutcome> {
    const {projectId, traceIds} = args

    if (traceIds.length === 0) {
        return {traces: new Map(), cacheHits: 0, cacheMisses: 0, fetchMs: 0}
    }

    let qc: ReturnType<typeof getQc> | null = null
    try {
        qc = getQc()
    } catch {
        // No Jotai store available — fall through to fetch-everything
    }

    const out = new Map<string, TracesApiResponse>()
    const misses: string[] = []

    if (qc) {
        for (const tid of traceIds) {
            const cached = qc.getQueryData<TracesApiResponse>(cacheKey(projectId, tid))
            if (cached) {
                out.set(tid, cached)
            } else {
                misses.push(tid)
            }
        }
    } else {
        misses.push(...traceIds)
    }

    let fetchMs = 0
    if (misses.length > 0) {
        const start = performance.now()

        // Bulk-fetch all misses in ONE network call.
        //
        // We deliberately do NOT route through `traceBatchFetcher` here. That
        // fetcher exists to *coalesce* concurrent per-id calls (e.g. many
        // React components calling `traceEntityAtomFamily(id)` in the same
        // microtask) into a single bulk request, with `maxBatchSize: 50`
        // splitting larger batches into multiple network calls. For
        // already-bulk inputs (our case), that splitting becomes a regression:
        // 100 trace_ids → 2 round trips instead of 1.
        //
        // Calling `fetchAllPreviewTraces` directly with an `IN` filter on all
        // ids gives us a single round trip regardless of input size. We still
        // write each result to the shared `["trace-entity", projectId, traceId]`
        // cache key, so atom subscribers using `traceEntityAtomFamily` see the
        // same data the batch-fetcher path would have produced.
        const canonicalIds = misses.map((id) => id.replace(/-/g, ""))
        try {
            const data = await fetchAllPreviewTraces(
                {
                    focus: "trace",
                    format: "agenta",
                    filter: JSON.stringify({
                        conditions: [{field: "trace_id", operator: "in", value: canonicalIds}],
                    }),
                },
                "",
                projectId,
            )

            const tracesObj = (data as {traces?: Record<string, unknown>} | null)?.traces ?? {}

            // Rekey by dashed trace_id (the value callers see in
            // `result.trace_id`) and populate cache.
            misses.forEach((traceId, idx) => {
                const canon = canonicalIds[idx]
                const traceData = tracesObj[canon]
                if (traceData) {
                    // Match `fetchPreviewTrace` envelope shape so atom
                    // subscribers parse it consistently.
                    const envelope = {
                        count: 1,
                        traces: {[canon]: traceData},
                    } as unknown as TracesApiResponse
                    out.set(traceId, envelope)
                    if (qc) qc.setQueryData(cacheKey(projectId, traceId), envelope)
                } else if (qc) {
                    // Negative cache — trace genuinely not yet ingested.
                    qc.setQueryData(cacheKey(projectId, traceId), null)
                }
            })
        } catch (e) {
            // On error, leave cache untouched. Caller can decide to retry.
            console.warn(
                `[prefetchTracesByIds] bulk fetch failed: ${e instanceof Error ? e.message : e}`,
            )
        }

        fetchMs = performance.now() - start
    }

    return {
        traces: out,
        cacheHits: traceIds.length - misses.length,
        cacheMisses: misses.length,
        fetchMs,
    }
}

export function invalidateTrace({projectId, traceId}: {projectId: string; traceId: string}) {
    try {
        getQc().removeQueries({queryKey: cacheKey(projectId, traceId)})
    } catch {}
}

/**
 * Bulk-evict trace cache entries — the per-chunk counterpart of
 * `prefetchTracesByIds`. An ETL chunk-release hook calls this once a
 * chunk is consumed so heap stays bounded by chunk size, not dataset
 * size. Takes dashed trace_ids (as they appear in `result.trace_id`).
 * Returns the number of entries removed — includes negative-cache
 * (`null`) entries written for traces not yet ingested.
 */
export function evictTracesByIds({
    projectId,
    traceIds,
}: {
    projectId: string
    traceIds: string[]
}): number {
    let removed = 0
    try {
        const qc = getQc()
        for (const tid of traceIds) {
            const key = cacheKey(projectId, tid)
            // `!== undefined` (not truthiness) so negative-cache `null`
            // entries are evicted too.
            if (qc.getQueryData(key) !== undefined) {
                qc.removeQueries({queryKey: key, exact: true})
                removed++
            }
        }
    } catch {
        // No queryClient — nothing to evict.
    }
    return removed
}
