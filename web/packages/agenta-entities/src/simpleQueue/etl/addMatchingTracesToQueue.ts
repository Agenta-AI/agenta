/**
 * addAllMatchingTracesToQueue — the batch-add-to-queue ETL pipeline.
 *
 * Composes the generic ETL primitives — `makeSourceFromCursorFetch` →
 * `makeUniqueKeyTransform` → `makeBufferedBatchSink` — driven by `runLoop`.
 * Pages every trace matching a filter, dedups by `trace_id`, and flushes
 * trace ids to an annotation queue.
 *
 * Transport is injected: `fetchPage` (the trace-query adapter, owned by the
 * observability layer) and `addTraces` (the queue mutation). The pipeline
 * itself depends only on `@agenta/entities/etl` — pure and unit-testable.
 *
 * See docs/designs/etl-batch-add-traces.md.
 *
 * @packageDocumentation
 */

import {
    makeBufferedBatchSink,
    makeSourceFromCursorFetch,
    makeUniqueKeyTransform,
    runLoop,
    type CursorPage,
    type LoopResult,
} from "../../etl"

/** Minimal shape the pipeline reads from a scanned trace row. */
export interface ScannedTrace {
    trace_id?: string
}

/** One page of traces matching the filter. */
export type TracePage = CursorPage<ScannedTrace>

/** Fetches one page of matching traces; `cursor` is `null` for the first page. */
export type TracePageFetcher = (cursor: string | null, signal: AbortSignal) => Promise<TracePage>

/** Queue mutation — resolves to the queue id on success, `null` on failure. */
export type AddTracesToQueue = (queueId: string, traceIds: string[]) => Promise<string | null>

export interface AddMatchingTracesProgress {
    /** Trace rows scanned so far. */
    scanned: number
    /** Unique trace ids submitted to the queue so far. */
    queued: number
}

export interface AddMatchingTracesResult {
    /** Unique trace ids submitted to the queue. */
    queued: number
    /** Trace rows scanned. */
    scanned: number
    /** How the run ended. */
    stoppedBy: "done" | "cancelled" | "cap"
}

export interface AddMatchingTracesOptions {
    /** Fetches one page of traces matching the filter. */
    fetchPage: TracePageFetcher
    /** Queue mutation that adds a batch of trace ids. */
    addTraces: AddTracesToQueue
    /** Target queue. Must be a `kind = traces` queue. */
    queueId: string
    /** Abort signal — cancels the scan and stops further flushes. */
    signal?: AbortSignal
    /** Trace ids per flush. Default 250. */
    batchSize?: number
    /** Delay between page requests, ms. Default 100. */
    pageDelayMs?: number
    /** Trace ids already in the queue — excluded from the add. */
    excludeTraceIds?: ReadonlySet<string>
    /** Safety ceiling on traces scanned. Default 20 000. */
    maxTraces?: number
    /** Live progress callback, fired after each page and once at the end. */
    onProgress?: (progress: AddMatchingTracesProgress) => void
}

/** Safety ceiling on traces scanned in one run. */
const DEFAULT_MAX_TRACES = 20_000

/**
 * Scan every trace matching the filter and add them to an annotation queue.
 * Resolves when the scan completes, is cancelled, or hits the cap. Throws
 * `BatchFlushError` (re-exported from `@agenta/entities/etl`) if a flush
 * fails mid-run.
 */
export const addAllMatchingTracesToQueue = async ({
    fetchPage,
    addTraces,
    queueId,
    signal,
    batchSize,
    pageDelayMs,
    excludeTraceIds,
    maxTraces = DEFAULT_MAX_TRACES,
    onProgress,
}: AddMatchingTracesOptions): Promise<AddMatchingTracesResult> => {
    const source = makeSourceFromCursorFetch<ScannedTrace>({fetchPage, pageDelayMs})
    const transform = makeUniqueKeyTransform<ScannedTrace>({
        selectKey: (trace) => trace.trace_id,
        exclude: excludeTraceIds,
    })
    const sinkHandle = makeBufferedBatchSink<string>({
        batchSize,
        signal,
        flush: async (batch) => {
            const result = await addTraces(queueId, batch)
            // The queue mutation signals a handled failure with `null`.
            if (result == null) {
                throw new Error(`addTraces returned null for queue ${queueId}`)
            }
        },
    })

    const gen = runLoop<ScannedTrace, string>(
        source,
        [transform],
        sinkHandle.sink,
        undefined,
        signal,
    )

    let scanned = 0
    let cappedOut = false

    try {
        while (true) {
            const step = await gen.next()
            if (step.done) {
                scanned = step.value.scanned
                break
            }
            scanned = step.value.scanned
            // `Progress.loaded` is flushed-so-far; the final partial batch is
            // reconciled from the sink handle after the loop.
            onProgress?.({scanned, queued: step.value.loaded})

            if (scanned >= maxTraces) {
                cappedOut = true
                // Stop the generator — its `finally` runs `sink.finalize`,
                // flushing the buffered remainder.
                await gen.return({
                    scanned,
                    matched: 0,
                    loaded: sinkHandle.getFlushedCount(),
                    cursor: null,
                    done: true,
                } satisfies LoopResult)
                break
            }
        }
    } catch (err) {
        // An abort surfaces as a thrown error from an in-flight request — if
        // the caller cancelled, treat any failure as cancellation.
        if (signal?.aborted) {
            return {queued: sinkHandle.getFlushedCount(), scanned, stoppedBy: "cancelled"}
        }
        // BatchFlushError (and anything else) surfaces to the caller.
        throw err
    }

    const queued = sinkHandle.getFlushedCount()
    onProgress?.({scanned, queued})

    return {
        queued,
        scanned,
        stoppedBy: cappedOut ? "cap" : signal?.aborted ? "cancelled" : "done",
    }
}
