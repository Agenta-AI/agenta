/**
 * @agenta/entities/etl
 *
 * General-purpose chunked iteration engine for ETL pipelines.
 *
 * Defines four contracts (Source, Transform, Sink, Chunk) and one
 * runtime (runLoop). Zero entity coupling. See docs/designs/etl-engine.md
 * for the design RFC, docs/designs/eval-etl-engine.md for the canonical
 * consumer (eval's filter pipeline).
 *
 * @example
 * ```ts
 * import { runLoop } from "@agenta/entities/etl"
 *
 * const source: Source<MyRow> = { ... }
 * const transform: Transform<MyRow, MyRow> = (chunk) => ({ ...chunk, items: chunk.items.filter(p) })
 * const sink: Sink<MyRow> = { load: async (chunk) => ({ loadedCount: chunk.items.length }) }
 *
 * for await (const progress of runLoop(source, [transform], sink, params, signal)) {
 *   console.log(progress)
 * }
 * ```
 *
 * @packageDocumentation
 */

export type {
    Chunk,
    ChunkMeta,
    Cursor,
    JoinedCursor,
    JoinState,
    LoadResult,
    LoopResult,
    MultiSourceTransform,
    Progress,
    Sink,
    Source,
    Transform,
} from "./core/types"

export {runLoop} from "./runtime/runLoop"

export {makeSourceFromPaginatedStore} from "./adapters/makeSourceFromPaginatedStore"
export type {MakeSourceParams, PaginatedStoreLike} from "./adapters/makeSourceFromPaginatedStore"

export {makeSourceFromCursorFetch} from "./adapters/makeSourceFromCursorFetch"
export type {CursorFetchSourceConfig, CursorPage} from "./adapters/makeSourceFromCursorFetch"

export {BatchFlushError, makeBufferedBatchSink} from "./sinks/makeBufferedBatchSink"
export type {BufferedBatchSinkConfig, BufferedBatchSinkHandle} from "./sinks/makeBufferedBatchSink"

export {makeUniqueKeyTransform} from "./transforms/makeUniqueKeyTransform"
export type {UniqueKeyTransformConfig} from "./transforms/makeUniqueKeyTransform"
