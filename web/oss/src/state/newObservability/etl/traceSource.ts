/**
 * traceSource — an ETL `Source<TraceSpanNode>` over the observability filter.
 *
 * Pages `executeTraceQuery` by cursor and yields one `Chunk` per server
 * response. The cursor-advance loop, the empty-page no-progress guard, and
 * request throttling live here; the per-page query mechanics it depends on
 * (the two-step annotation-filter pagination, the `+1ms` cursor bump,
 * `AbortSignal` plumbing) stay in `executeTraceQuery`, unchanged.
 *
 * First Source built for the ETL engine over traces — see
 * docs/designs/etl-batch-add-traces.md. CSV export keeps its own scan loop
 * (`fetchAllTracesForExport`); this does not touch it.
 */

import type {Chunk, Source} from "@agenta/entities/etl"

import {TraceSpanNode} from "@/oss/services/tracing/types"

import {Condition, executeTraceQuery} from "../atoms/queryHelpers"

/** Empty pages in a row before the scan declares "cursor not advancing". */
const MAX_EMPTY_PAGES = 3
/** Default rows requested per page. */
const DEFAULT_PAGE_SIZE = 500
/** Throttle between page requests, ms — reduces API load on long scans. */
const DEFAULT_PAGE_DELAY_MS = 100

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Params for a trace scan. Mirrors the inputs `buildTraceQueryParams`
 * produces, plus optional page-size / throttle tuning.
 */
export interface TraceScanParams {
    /** Observability query params (filter, focus, sort window). */
    params: Record<string, any>
    appId: string
    isHasAnnotationSelected: number
    hasAnnotationConditions: Condition[]
    hasAnnotationOperator?: string
    /** Rows per page request. Default 500. */
    pageSize?: number
    /** Delay between page requests, ms. Default 100. */
    pageDelayMs?: number
}

/**
 * `Source<TraceSpanNode>` — yields one chunk of top-level trace nodes per
 * server page. `cursor: null` on the final chunk signals end-of-stream to
 * `runLoop`; the loop also stops when the source returns.
 */
export const traceSource: Source<TraceSpanNode, TraceScanParams> = {
    async *extract(params, signal): AsyncIterable<Chunk<TraceSpanNode>> {
        const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE
        const pageDelayMs = params.pageDelayMs ?? DEFAULT_PAGE_DELAY_MS

        const scanParams: Record<string, any> = {...params.params, size: pageSize}
        // `executeTraceQuery` pages strictly backwards from `newest`; seed it
        // with "now" when the caller's window has no upper bound.
        if (!scanParams.newest) {
            scanParams.newest = new Date().toISOString()
        }

        let cursor: string | null = null
        let emptyPageCount = 0

        while (true) {
            // Cooperative cancellation between pages. An abort mid-fetch is
            // surfaced by `executeTraceQuery` throwing `AbortError`.
            if (signal.aborted) return

            const result = await executeTraceQuery({
                params: scanParams,
                pageParam: cursor ? {newest: cursor} : undefined,
                appId: params.appId,
                isHasAnnotationSelected: params.isHasAnnotationSelected,
                hasAnnotationConditions: params.hasAnnotationConditions,
                hasAnnotationOperator: params.hasAnnotationOperator,
                signal,
            })

            emptyPageCount = result.traces.length === 0 ? emptyPageCount + 1 : 0
            const nextCursor: string | null = result.nextCursor ?? null
            // Safety: the cursor stopped advancing (pages keep coming back
            // empty) — treat as end-of-stream so the loop can't spin.
            const stalled = emptyPageCount >= MAX_EMPTY_PAGES
            const lastChunk = nextCursor === null || stalled

            yield {
                items: result.traces,
                cursor: lastChunk ? null : nextCursor,
            }

            if (lastChunk) return

            await delay(pageDelayMs)
            cursor = nextCursor
        }
    },
}
