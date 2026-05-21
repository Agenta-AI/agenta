/**
 * ETL Loop Engine — Contracts
 *
 * The four shapes that define the engine. No DSL, no implementations,
 * just the protocol. See docs/designs/etl-engine.md for the design RFC.
 *
 * Five guarantees of the loop runtime:
 *   1. Pipeline memory bounded by chunk size
 *   2. Cancellation through the loop body (via AbortSignal)
 *   3. Progress is observable (yielded per chunk)
 *   4. Backpressure is natural (await sink.load)
 *   5. Idempotent resume is possible (cursor + AbortSignal + deterministic sink)
 *
 * @packageDocumentation
 */

// ============================================================================
// CURSOR — opaque pagination token
// ============================================================================

/**
 * Cursor for paginated sources. The server emits an opaque string and the
 * client passes it back verbatim in the next request's windowing.next.
 * No client-side arithmetic.
 *
 * Object cursors are reserved for joined sources (see JoinedCursor).
 * Null means "end of stream".
 */
export type Cursor = string | number | object | null

/**
 * Cursor shape for MultiSourceTransform-driven sources (e.g. derived.joined).
 * Each side advances independently; the loop carries both.
 */
export interface JoinedCursor {
    aCursor: string | null
    bCursor: string | null
}

// ============================================================================
// CHUNK — unit of iteration
// ============================================================================

/**
 * Chunk metadata. Opaque to the loop; consumers can attach hints
 * (source name, page index, server response headers).
 */
export interface ChunkMeta {
    page?: number
    hint?: string
    [k: string]: unknown
}

/**
 * A chunk carries its items plus enough metadata for the loop to advance.
 * Cursor `null` signals end of stream.
 */
export interface Chunk<T> {
    items: T[]
    cursor: Cursor | null
    meta?: ChunkMeta
}

// ============================================================================
// SOURCE — lazy producer of chunks
// ============================================================================

/**
 * A Source produces chunks lazily. AsyncIterable means the loop can pull
 * one chunk at a time without holding earlier chunks in memory.
 *
 * Implementations must:
 *   - Check `signal.aborted` between fetches and exit cleanly when set
 *   - Yield one chunk per server response; let the loop advance the cursor
 *   - Yield a final chunk with `cursor: null` when exhausted, OR return
 *     before yielding (both signal end-of-stream to the loop)
 */
export interface Source<T, Params = unknown> {
    extract(params: Params, signal: AbortSignal): AsyncIterable<Chunk<T>>
}

// ============================================================================
// TRANSFORM — chunk → chunk
// ============================================================================

/**
 * A Transform is a pure (or pure-ish) function from one chunk to another.
 * Compose by array — each transform in `runLoop`'s transforms[] runs in
 * declared order. Short-circuits on empty: if a transform returns an
 * empty chunk, subsequent transforms are skipped for that iteration.
 *
 * Async permitted (e.g. to await prefetched correlated data inside a
 * predicate) but slow paths cost the loop directly — backpressure is
 * the loop's behavior, not the transform's responsibility.
 */
export type Transform<In, Out> = (chunk: Chunk<In>) => Chunk<Out> | Promise<Chunk<Out>>

/**
 * Carries state across chunk boundaries during a multi-source join.
 * Typically a Map<joinKey, sourceBRow> accumulator. Consumer-defined;
 * the engine just threads it through the transform on each chunk.
 */
export interface JoinState {
    hashMap?: Map<unknown, unknown>
    [k: string]: unknown
}

/**
 * A MultiSourceTransform reads from two chunks simultaneously, threading
 * state across chunk boundaries. Used by derived.joined to implement
 * client-side joins. See open question 8 in the design RFC.
 */
export type MultiSourceTransform<A, B, Out> = (
    chunkA: Chunk<A>,
    chunkB: Chunk<B>,
    state: JoinState,
) => Chunk<Out> | Promise<Chunk<Out>>

// ============================================================================
// SINK — chunk consumer
// ============================================================================

/**
 * Result of a successful sink load. `loadedCount` may differ from
 * `chunk.items.length` (e.g. a deduplicating sink).
 */
export interface LoadResult {
    loadedCount?: number
    warnings?: string[]
}

/**
 * A Sink consumes chunks. `finalize?` is for commit-style sinks
 * (testset revision commit, file close) — the loop calls it in a
 * `finally` block so it runs on cancellation or error as well as
 * normal completion.
 */
export interface Sink<T> {
    load(chunk: Chunk<T>): Promise<LoadResult>
    finalize?(): Promise<void>
}

// ============================================================================
// PROGRESS — yielded per loop iteration
// ============================================================================

/**
 * Progress event yielded after each chunk. Consumers read this to update
 * UI counters, decide when to break out of the loop, or trigger
 * tier-escalation in filter pipelines.
 */
export interface Progress {
    scanned: number
    matched: number
    loaded: number
    cursor: Cursor | null
}

/**
 * The loop's final return value. Includes everything Progress carries
 * plus a `done` flag distinguishing normal completion from cancellation
 * mid-iteration.
 */
export interface LoopResult extends Progress {
    done: boolean
}

// ============================================================================
// CHUNK RELEASE HOOK — per-chunk cache eviction
// ============================================================================

/**
 * Called once a chunk has been fully consumed by the sink. At this point
 * nothing downstream in the loop needs the chunk's data — the safe point
 * to release per-chunk side-effect caches (e.g. the entity caches a
 * hydrate transform populated) so heap stays bounded by chunk size, not
 * by dataset size.
 *
 * The loop's guarantee #1 ("memory bounded") covers the loop's own chunk
 * variable — it does NOT cover caches a transform writes as a side
 * effect. This hook is how a consumer extends that guarantee to those
 * side-effect caches without the loop having to know about them.
 *
 * Receives the post-transform chunk, so the handler can walk every
 * entity id the materialized rows reference. Note: if a transform that
 * runs AFTER the cache-populating transform drops rows (e.g. a
 * post-hydrate filter), the handler only sees the surviving rows — a
 * cache-populating transform that is followed by a row-dropping
 * transform should tag `chunk.meta` with its full id manifest instead.
 */
export type ChunkReleaseHook<T> = (chunk: Chunk<T>) => void | Promise<void>
