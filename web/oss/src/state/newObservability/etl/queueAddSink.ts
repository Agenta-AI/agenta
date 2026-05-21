/**
 * queueAddSink — an ETL `Sink<string>` that writes trace_ids to an
 * annotation queue.
 *
 * Buffers incoming trace_ids and flushes `addTraces(queueId, batch)` every
 * `flushSize` (~250, tunable, decoupled from the scan page size — bounded
 * payload, ~8 background jobs for 2000 traces, not ~40).
 *
 *   - `load`     flushes every full batch the buffer can produce.
 *   - `finalize` flushes the remainder on clean completion. On cancel or
 *                after a failed flush it drops the buffer instead, so a
 *                partial add stays a clean multiple of `flushSize`.
 *   - a failed flush throws `QueueAddError` (carries the queued-so-far
 *     count) — surfaces, never silent.
 *
 * See docs/designs/etl-batch-add-traces.md.
 */

import type {Chunk, LoadResult, Sink} from "@agenta/entities/etl"

/** Default trace_ids per flush. */
const DEFAULT_FLUSH_SIZE = 250

/**
 * A flush to the queue failed mid-run. Carries how many trace_ids were
 * successfully queued before the failure so the UI can show an honest
 * partial-state message and offer a retry.
 */
export class QueueAddError extends Error {
    /** Trace_ids successfully queued before the failure. */
    readonly queuedCount: number
    /** Size of the batch that failed to queue. */
    readonly failedCount: number
    /** The underlying error, when the failure was a thrown exception. */
    readonly originalError?: unknown

    constructor(queuedCount: number, failedCount: number, originalError?: unknown) {
        super(`Failed to queue ${failedCount} trace(s); ${queuedCount} queued before the failure`)
        this.name = "QueueAddError"
        this.queuedCount = queuedCount
        this.failedCount = failedCount
        this.originalError = originalError
    }
}

export interface QueueAddSinkOptions {
    queueId: string
    /**
     * Server mutation. Resolves to the queue id on success, `null` on a
     * handled failure. Injected so the sink stays unit-testable.
     */
    addTraces: (queueId: string, traceIds: string[]) => Promise<string | null>
    /** Trace_ids per flush. Default 250. */
    flushSize?: number
    /**
     * Run abort signal. When aborted, `finalize` drops the buffer instead of
     * flushing it — the partial add stays a clean multiple of `flushSize`.
     */
    signal?: AbortSignal
}

export interface QueueAddSinkHandle {
    sink: Sink<string>
    /** Trace_ids successfully flushed to the queue so far. */
    getFlushedCount(): number
}

/**
 * Build a `Sink<string>` plus a handle exposing the authoritative
 * flushed-count (the engine's `Progress.loaded` lags by the unflushed
 * buffer and never sees the `finalize` flush).
 */
export const createQueueAddSink = ({
    queueId,
    addTraces,
    flushSize = DEFAULT_FLUSH_SIZE,
    signal,
}: QueueAddSinkOptions): QueueAddSinkHandle => {
    let buffer: string[] = []
    let flushed = 0
    let errored = false

    const flushBatch = async (batch: string[]): Promise<void> => {
        let queueIdResult: string | null
        try {
            queueIdResult = await addTraces(queueId, batch)
        } catch (err) {
            errored = true
            throw new QueueAddError(flushed, batch.length, err)
        }
        if (queueIdResult == null) {
            errored = true
            throw new QueueAddError(flushed, batch.length)
        }
        flushed += batch.length
    }

    return {
        getFlushedCount: () => flushed,
        sink: {
            async load(chunk: Chunk<string>): Promise<LoadResult> {
                if (chunk.items.length > 0) buffer.push(...chunk.items)

                let flushedThisCall = 0
                while (buffer.length >= flushSize) {
                    const batch = buffer.slice(0, flushSize)
                    buffer = buffer.slice(flushSize)
                    await flushBatch(batch)
                    flushedThisCall += batch.length
                }
                // `loadedCount` is what the engine adds to `Progress.loaded` —
                // report only what actually reached the queue this call.
                return {loadedCount: flushedThisCall}
            },
            async finalize(): Promise<void> {
                // Drop the buffer on cancel / after a failed flush — keeps a
                // partial add a clean multiple of `flushSize`.
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
