/**
 * exportMatchingTraces — the bulk-trace export ETL pipeline.
 *
 * Composes the generic ETL primitives — `makeSourceFromCursorFetch` →
 * flattenSpanTrees (transform) → dedupAndCap (transform) → optional `enrich`
 * (transform) → `makeBufferedBatchSink` — driven by `runLoop`. Pages every
 * trace matching a filter, flattens each tree into the flat list of its
 * descendant spans, dedups by row key, caps at `maxRows`, optionally joins
 * correlated data a row does not carry, and flushes deduplicated rows in
 * fixed-size batches to a caller-provided `flushBatch` transport.
 *
 * Format-agnostic by design: the caller's `flushBatch` does the CSV/JSON/...
 * encoding and accumulation. Mirrors `addAllMatchingTracesToQueue` — both
 * pipelines share the same Source contract; the difference is what the sink
 * does with each batch.
 *
 * @packageDocumentation
 */

import {
    makeBufferedBatchSink,
    makeSourceFromCursorFetch,
    runLoop,
    type Chunk,
    type CursorPage,
    type LoopResult,
    type Transform,
} from "../../etl"
import type {TraceSpan} from "../core"

/**
 * Minimum shape the pipeline reads from each scanned row. The actual rows
 * passed through to `flushBatch` are whatever `T` the caller chose — the
 * pipeline only ever reads `trace_id`, `span_id`, `parent_id`, `start_time`,
 * and `children` here.
 *
 * The span fields are picked from `TraceSpan` rather than redeclared so this
 * contract cannot drift from the schema that validates the payload — that
 * drift is what required boundary casts before.
 */
export interface ScannedExportRow extends Pick<
    TraceSpan,
    "trace_id" | "span_id" | "parent_id" | "start_time"
> {
    children?: readonly ScannedExportRow[] | null
}

/** One page of root traces matching the filter. */
export type ExportTracePage<T extends ScannedExportRow> = CursorPage<T>

/** Fetches one page of matching traces; `cursor` is `null` for the first page. */
export type ExportTracePageFetcher<T extends ScannedExportRow> = (
    cursor: string | null,
    signal: AbortSignal,
) => Promise<ExportTracePage<T>>

/** A single batch of deduplicated rows handed to the caller's transport. */
export type FlushBatch<T extends ScannedExportRow> = (rows: T[]) => Promise<void>

export interface ExportMatchingTracesProgress {
    /** Root traces yielded by the source so far (counts tree roots, not spans). */
    scanned: number
    /**
     * Unique rows the pipeline has produced for the sink so far (post-
     * dedup, post-cap). Reflects the user-visible "rows exported"
     * regardless of the sink's batching cadence — the buffered batch sink
     * holds rows until a full batch flushes, so reporting the flushed
     * count instead leaves the UI stuck at 0 for the first 500 rows of
     * every run.
     */
    rows: number
}

export interface ExportMatchingTracesResult {
    /** Unique rows successfully flushed. */
    rowCount: number
    /** Root traces scanned. */
    scanned: number
    /** True iff the scan stopped because `maxRows` was reached. */
    limitReached: boolean
    /** How the run ended. */
    stoppedBy: "done" | "cancelled" | "limit"
}

export interface ExportMatchingTracesOptions<T extends ScannedExportRow> {
    /** Fetches one page of matching traces. */
    fetchPage: ExportTracePageFetcher<T>
    /** Transport that consumes one batch of deduplicated rows. */
    flushBatch: FlushBatch<T>
    /**
     * Dedup key per row. Defaults to `trace_id:span_id`; a row missing either
     * id has no identity and is passed through undeduped.
     */
    selectKey?: (trace: T) => string
    /** Abort signal — cancels the scan and stops further flushes. */
    signal?: AbortSignal
    /** Delay between page requests, ms. Default 100. */
    pageDelayMs?: number
    /** Rows per `flushBatch` call. Default 500. */
    batchSize?: number
    /** Hard cap on unique rows emitted to `flushBatch`. Default 20 000. */
    maxRows?: number
    /** Live progress callback, fired after each page and once at the end. */
    onProgress?: (progress: ExportMatchingTracesProgress) => void
    /**
     * Optional last transform, applied AFTER dedup and the cap so it only runs for rows that
     * actually reach the sink. Async is allowed (see `Transform`), which is what makes this the
     * seam for correlated data a row does not carry — evaluator metrics live on annotations
     * linked to a span, not on the span, so they are fetched per chunk and merged here.
     *
     * Enrichment belongs here rather than in `flushBatch`: the sink is the format/transport
     * boundary, so anything done there cannot be reused by a different sink, and it sits
     * outside the loop's cancellation path.
     */
    enrich?: Transform<T, T>
}

/** Hard cap on unique rows in one export. */
export const DEFAULT_MAX_ROWS = 20_000
/** Rows per `flushBatch` call. */
export const DEFAULT_BATCH_SIZE = 500

/**
 * Dedup identity is `trace_id:span_id`; the schema makes both required, so
 * every row the tracing API produces takes that branch.
 *
 * A row that still arrives without one is treated as having no identity and is
 * never deduped: dedup can only drop what it can prove is a repeat, and for an
 * export emitting a duplicate row beats silently dropping a distinct one. The
 * counter is per-pipeline-run, and the `\0` prefix cannot collide with a real
 * key.
 */
const makeDefaultSelectKey = <T extends ScannedExportRow>(): ((row: T) => string) => {
    let unidentified = 0
    return (row) =>
        row.trace_id && row.span_id
            ? `${row.trace_id}:${row.span_id}`
            : `\0unidentified:${unidentified++}`
}

const collectDescendants = <T extends ScannedExportRow>(node: T, out: T[]): void => {
    out.push(node)
    const children = node.children
    if (children && Array.isArray(children)) {
        for (const child of children) collectDescendants(child as T, out)
    }
}

/** Expand each tree root into the flat list of all its descendant spans. */
const makeFlattenSpanTreesTransform = <T extends ScannedExportRow>(): Transform<T, T> => {
    return (chunk: Chunk<T>): Chunk<T> => {
        const flat: T[] = []
        for (const root of chunk.items) collectDescendants(root, flat)
        return {items: flat, cursor: chunk.cursor, meta: chunk.meta}
    }
}

/**
 * Row-preserving dedup with an emission cap. Mirrors `makeUniqueKeyTransform`
 * but emits the original rows (not just the keys) so the downstream sink can
 * format them. Inline here because no other pipeline needs row-preserving
 * dedup today — promote to a shared primitive when a second caller shows up.
 */
const makeDedupAndCapTransform = <T extends ScannedExportRow>(
    selectKey: (t: T) => string,
    maxRows: number,
): Transform<T, T> => {
    const seen = new Set<string>()
    let emitted = 0
    return (chunk: Chunk<T>): Chunk<T> => {
        const out: T[] = []
        for (const item of chunk.items) {
            if (emitted >= maxRows) break
            const key = selectKey(item)
            if (seen.has(key)) continue
            seen.add(key)
            out.push(item)
            emitted += 1
        }
        return {items: out, cursor: chunk.cursor, meta: chunk.meta}
    }
}

/**
 * Scan every trace matching the filter, flatten each tree, dedup, cap, and
 * flush rows in fixed-size batches to the caller's transport. Resolves when
 * the scan completes, is cancelled, or hits the row cap. Throws
 * `BatchFlushError` (re-exported from `@agenta/entities/etl`) if a flush
 * fails mid-run.
 */
export const exportMatchingTraces = async <T extends ScannedExportRow>({
    fetchPage,
    flushBatch,
    selectKey = makeDefaultSelectKey<T>(),
    signal,
    pageDelayMs,
    batchSize = DEFAULT_BATCH_SIZE,
    maxRows = DEFAULT_MAX_ROWS,
    onProgress,
    enrich,
}: ExportMatchingTracesOptions<T>): Promise<ExportMatchingTracesResult> => {
    const source = makeSourceFromCursorFetch<T>({fetchPage, pageDelayMs})
    const flatten = makeFlattenSpanTreesTransform<T>()
    const dedupCap = makeDedupAndCapTransform<T>(selectKey, maxRows)
    const sinkHandle = makeBufferedBatchSink<T>({batchSize, signal, flush: flushBatch})

    // `enrich` last: dedup and the cap decide what reaches the sink, so running it earlier
    // would fetch correlated data for rows that get dropped.
    const transforms: Transform<T, T>[] = enrich ? [flatten, dedupCap, enrich] : [flatten, dedupCap]

    const gen = runLoop<T, T>(source, transforms, sinkHandle.sink, undefined, signal)

    let scanned = 0
    let limitReached = false

    try {
        while (true) {
            const step = await gen.next()
            if (step.done) {
                scanned = step.value.scanned
                break
            }
            scanned = step.value.scanned
            // Report `matched` (post-dedup, post-cap) so the UI sees
            // immediate progress per page — `loaded` lags by the buffered
            // batch, which makes the toast appear stuck at 0 until the
            // first full batch flushes.
            onProgress?.({scanned, rows: step.value.matched})

            // Cap on matched (deduplicated) rows, not raw spans. The transform
            // already stops emitting past the cap; this just ends the scan
            // early so the next page isn't fetched uselessly. A `cursor` of
            // null means the source is already exhausted — a clean `done`,
            // not a cap, even if `matched` lands exactly on the limit.
            if (step.value.matched >= maxRows && step.value.cursor !== null) {
                limitReached = true
                await gen.return({
                    scanned,
                    matched: step.value.matched,
                    loaded: sinkHandle.getFlushedCount(),
                    cursor: null,
                    done: true,
                } satisfies LoopResult)
                break
            }
        }
    } catch (err) {
        // An abort surfaces as a thrown error from an in-flight request —
        // when the caller cancelled, treat any failure as cancellation.
        if (signal?.aborted) {
            return {
                rowCount: sinkHandle.getFlushedCount(),
                scanned,
                limitReached: false,
                stoppedBy: "cancelled",
            }
        }
        // BatchFlushError (and anything else) surfaces to the caller.
        throw err
    }

    const rowCount = sinkHandle.getFlushedCount()
    onProgress?.({scanned, rows: rowCount})

    return {
        rowCount,
        scanned,
        limitReached,
        stoppedBy: limitReached ? "limit" : signal?.aborted ? "cancelled" : "done",
    }
}
