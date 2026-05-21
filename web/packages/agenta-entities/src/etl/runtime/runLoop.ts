/**
 * ETL Loop Engine — Runtime
 *
 * The loop is one function. ~50 lines including comments. All five
 * guarantees from `core/types.ts` fall out of this code:
 *   1. Memory bounded: only `current` is held; previous chunks released
 *   2. Cancellation: `signal.aborted` checked between iterations
 *   3. Progress: yielded after every chunk
 *   4. Backpressure: `await sink.load` blocks the loop
 *   5. Cleanup: `finally` runs `sink.finalize?()` on any exit path
 *
 * See docs/designs/etl-engine.md for the design RFC.
 *
 * @packageDocumentation
 */

import type {
    Chunk,
    ChunkReleaseHook,
    Cursor,
    LoopResult,
    Progress,
    Sink,
    Source,
    Transform,
} from "../core/types"

/**
 * Iterate a pipeline chunk-by-chunk. AsyncGenerator yields a Progress
 * event after each chunk and returns a LoopResult when done or cancelled.
 *
 * Consumer usage:
 *   ```ts
 *   const gen = runLoop(source, [filter, project], sink, params, signal)
 *   for await (const progress of gen) {
 *     if (progress.matched >= viewportSize) break  // viewport-cancel
 *   }
 *   ```
 *
 * Or, with access to the final result:
 *   ```ts
 *   while (true) {
 *     const r = await gen.next()
 *     if (r.done) { result = r.value; break }
 *     handleProgress(r.value)
 *   }
 *   ```
 *
 * The loop accepts heterogeneous Transform arrays (`Transform<any, any>[]`)
 * because TypeScript can't express "chain of transforms" with a single
 * type parameter pair. Type safety on transforms is the consumer's
 * responsibility — usually trivial via factory functions that return
 * correctly-typed Transforms.
 */
// Type-erased Transform used in the loop's transforms[] array. TypeScript
// cannot express "chain of transforms where output of N matches input of N+1"
// with a single type parameter pair, so the engine accepts a heterogeneous
// chain. Type safety on transforms is the consumer's responsibility via
// factory functions returning correctly-typed Transforms (see worked examples).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTransform = Transform<any, any>

export async function* runLoop<TIn, TOut>(
    source: Source<TIn>,
    transforms: AnyTransform[],
    sink: Sink<TOut>,
    params: Parameters<Source<TIn>["extract"]>[0],
    signal?: AbortSignal,
    /**
     * Optional per-chunk release hook. Called after the sink has consumed
     * each chunk (and before the Progress yield, so it runs even when a
     * consumer viewport-cancels). Lets a consumer free per-chunk
     * side-effect caches — see `ChunkReleaseHook` in core/types.ts.
     */
    onChunkReleased?: ChunkReleaseHook<TOut>,
): AsyncGenerator<Progress, LoopResult> {
    const abort = signal ?? new AbortController().signal
    let scanned = 0
    let matched = 0
    let loaded = 0
    let lastCursor: Cursor | null = null

    try {
        for await (const chunk of source.extract(params, abort)) {
            if (abort.aborted) break

            scanned += chunk.items.length
            lastCursor = chunk.cursor

            // Run transforms in order. Short-circuit on empty.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let current: Chunk<any> = chunk
            for (const tx of transforms) {
                current = await tx(current)
                if (current.items.length === 0) break
            }

            matched += current.items.length

            if (current.items.length > 0) {
                const result = await sink.load(current as Chunk<TOut>)
                loaded += result.loadedCount ?? current.items.length
            }

            // Chunk fully consumed — let the consumer release any per-chunk
            // side-effect caches (e.g. hydrated entity caches). Runs before
            // `yield` so a viewport-cancel still releases this chunk.
            await onChunkReleased?.(current as Chunk<TOut>)

            yield {scanned, matched, loaded, cursor: lastCursor}

            // Source signaled end-of-stream via cursor: null
            if (chunk.cursor === null) break
        }
    } finally {
        await sink.finalize?.()
    }

    return {scanned, matched, loaded, cursor: lastCursor, done: true}
}
