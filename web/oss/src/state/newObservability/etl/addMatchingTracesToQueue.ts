/**
 * addAllMatchingTracesToQueue — the batch-add-to-queue ETL pipeline.
 *
 * Wires the ETL engine: `traceSource` → `extractTraceIds` → `queueAddSink`,
 * driven by `runLoop`. Pages every trace matching the observability filter,
 * dedups, and flushes trace_ids to an annotation queue.
 *
 * See docs/designs/etl-batch-add-traces.md.
 */

import {runLoop, type Chunk, type LoopResult, type Transform} from "@agenta/entities/etl"
import {simpleQueueMolecule} from "@agenta/entities/simpleQueue"

import {TraceSpanNode} from "@/oss/services/tracing/types"

import {createQueueAddSink, QueueAddError} from "./queueAddSink"
import {traceSource, type TraceScanParams} from "./traceSource"

/** Safety ceiling on traces scanned in one run (parity with CSV export). */
const DEFAULT_MAX_TRACES = 20_000

/**
 * Transform: `Chunk<TraceSpanNode>` → `Chunk<string>` (unique trace_ids).
 *
 * Factory — captures a `Set` for cross-chunk dedup. `excludeTraceIds` (e.g.
 * trace_ids already in the queue) are marked seen but never emitted. Every
 * span of a trace shares its `trace_id`, so iterating top-level nodes and
 * deduping is complete — no need to recurse into `children`.
 */
const createTraceIdExtractor = (
    excludeTraceIds?: Set<string>,
): Transform<TraceSpanNode, string> => {
    const seen = new Set<string>()
    return (chunk: Chunk<TraceSpanNode>): Chunk<string> => {
        const ids: string[] = []
        for (const node of chunk.items) {
            const id = node.trace_id
            if (!id || seen.has(id)) continue
            seen.add(id)
            if (excludeTraceIds?.has(id)) continue
            ids.push(id)
        }
        return {items: ids, cursor: chunk.cursor, meta: chunk.meta}
    }
}

export interface AddMatchingTracesProgress {
    /** Trace nodes scanned so far. */
    scanned: number
    /** Unique trace_ids submitted to the queue so far. */
    queued: number
}

export interface AddMatchingTracesResult {
    /** Unique trace_ids submitted to the queue. */
    queued: number
    /** Trace nodes scanned. */
    scanned: number
    /** How the run ended. */
    stoppedBy: "done" | "cancelled" | "cap"
}

export interface AddMatchingTracesOptions {
    /** Trace scan params — what the observability filter resolved to. */
    scan: TraceScanParams
    /** Target queue. Must be a `kind = traces` queue. */
    queueId: string
    /** Abort signal — cancels the scan and stops further flushes. */
    signal?: AbortSignal
    /** Trace_ids per flush. Default 250. */
    flushSize?: number
    /** Trace_ids already in the queue — excluded from the add. */
    excludeTraceIds?: Set<string>
    /** Safety ceiling on traces scanned. Default 20 000. */
    maxTraces?: number
    /** Live progress callback, fired after each page and once at the end. */
    onProgress?: (progress: AddMatchingTracesProgress) => void
}

/**
 * Scan every trace matching the observability filter and add them to an
 * annotation queue. Resolves when the scan completes, is cancelled, or hits
 * the cap. Throws `QueueAddError` if a flush fails mid-run.
 */
export const addAllMatchingTracesToQueue = async ({
    scan,
    queueId,
    signal,
    flushSize,
    excludeTraceIds,
    maxTraces = DEFAULT_MAX_TRACES,
    onProgress,
}: AddMatchingTracesOptions): Promise<AddMatchingTracesResult> => {
    const transform = createTraceIdExtractor(excludeTraceIds)
    const sinkHandle = createQueueAddSink({
        queueId,
        flushSize,
        signal,
        addTraces: (qid, ids) => simpleQueueMolecule.set.addTraces(qid, ids),
    })

    const gen = runLoop<TraceSpanNode, string>(
        traceSource,
        [transform],
        sinkHandle.sink,
        scan,
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
        // QueueAddError (and anything else) surfaces to the caller.
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

export {QueueAddError}
