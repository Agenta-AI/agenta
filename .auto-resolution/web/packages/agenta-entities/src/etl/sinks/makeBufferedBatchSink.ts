/**
 * makeBufferedBatchSink — an ETL `Sink<T>` that buffers items and flushes
 * them in fixed-size batches.
 *
 * Decouples the flush size from the scan page size: a 500-row page can flush
 * as two 250-item batches, and a partial batch carries across page
 * boundaries. The caller injects only the `flush` transport.
 *
 *   - `load`     flushes every full batch the buffer can produce.
 *   - `finalize` flushes the remainder on clean completion. On cancel or
 *                after a failed flush it drops the buffer instead, so a
 *                partial write stays a clean multiple of `batchSize`.
 *   - a failed flush throws `BatchFlushError` (carries the flushed-so-far
 *     count) — surfaces, never silent.
 *
 * @packageDocumentation
 */

import type {Chunk, LoadResult, Sink} from "../core/types"

/** Default items per flush. */
const DEFAULT_BATCH_SIZE = 250

/**
 * A batch flush failed mid-run. Carries how many items were successfully
 * flushed before the failure so callers can render an honest partial state.
 */
export class BatchFlushError extends Error {
    /** Items successfully flushed before the failure. */
    readonly flushedCount: number
    /** Size of the batch that failed to flush. */
    readonly failedCount: number
    /** The underlying error, when the failure was a thrown exception. */
    readonly originalError?: unknown

    constructor(flushedCount: number, failedCount: number, originalError?: unknown) {
        super(
            `Batch flush failed for ${failedCount} item(s); ` +
                `${flushedCount} flushed before the failure`,
        )
        this.name = "BatchFlushError"
        this.flushedCount = flushedCount
        this.failedCount = failedCount
        this.originalError = originalError
    }
}

export interface BufferedBatchSinkConfig<T> {
    /** Flush one batch. A throw is wrapped as `BatchFlushError`. */
    flush: (batch: T[]) => Promise<void>
    /** Items per flush. Default 250. */
    batchSize?: number
    /**
     * Run abort signal. When aborted, `finalize` drops the buffer instead of
     * flushing it — the partial write stays a clean multiple of `batchSize`.
     */
    signal?: AbortSignal
}

export interface BufferedBatchSinkHandle<T> {
    sink: Sink<T>
    /** Items successfully flushed so far. */
    getFlushedCount(): number
}

/**
 * Build a `Sink<T>` plus a handle exposing the authoritative flushed-count
 * (the engine's `Progress.loaded` lags by the unflushed buffer and never sees
 * the `finalize` flush).
 */
export function makeBufferedBatchSink<T>(
    config: BufferedBatchSinkConfig<T>,
): BufferedBatchSinkHandle<T> {
    const {flush, batchSize = DEFAULT_BATCH_SIZE, signal} = config

    let buffer: T[] = []
    let flushed = 0
    let errored = false

    const flushBatch = async (batch: T[]): Promise<void> => {
        try {
            await flush(batch)
        } catch (err) {
            errored = true
            throw new BatchFlushError(flushed, batch.length, err)
        }
        flushed += batch.length
    }

    return {
        getFlushedCount: () => flushed,
        sink: {
            async load(chunk: Chunk<T>): Promise<LoadResult> {
                if (chunk.items.length > 0) buffer.push(...chunk.items)

                let flushedThisCall = 0
                while (buffer.length >= batchSize) {
                    const batch = buffer.slice(0, batchSize)
                    buffer = buffer.slice(batchSize)
                    await flushBatch(batch)
                    flushedThisCall += batch.length
                }
                // `loadedCount` is what the engine adds to `Progress.loaded` —
                // report only what actually flushed this call.
                return {loadedCount: flushedThisCall}
            },
            async finalize(): Promise<void> {
                // Drop the buffer on cancel / after a failed flush — keeps a
                // partial write a clean multiple of `batchSize`.
                if (errored || signal?.aborted) {
                    buffer = []
                    return
                }
                if (buffer.length > 0) {
                    const batch = buffer
                    buffer = []
                    await flushBatch(batch)
                }
            },
        },
    }
}
