/**
 * Engine memory bounds — assertions, not observations.
 *
 * The design RFC claims "pipeline memory bounded by chunk size." This file
 * encodes that claim as enforceable tests. They require `--expose-gc` so we
 * can force a deterministic baseline before measurement.
 *
 * Run:
 *   pnpm --filter @agenta/entities test:etl:memory
 *
 * Or directly:
 *   pnpm exec tsx --test --node-options="--expose-gc" \
 *     src/etl/__tests__/runLoop.memory.test.ts
 *
 * If `global.gc` is unavailable (running without `--expose-gc`), tests skip
 * rather than fail — local `pnpm test:etl` still works for everyone.
 */

import assert from "node:assert/strict"
import {describe, it} from "node:test"

import type {Chunk, Sink, Source} from "../core/types"
import {runLoop} from "../runtime/runLoop"

// ============================================================================
// Helpers
// ============================================================================

/**
 * Whether forced GC is available (requires --expose-gc).
 */
const hasGc = typeof (globalThis as {gc?: () => void}).gc === "function"

function forceGc() {
    ;(globalThis as {gc?: () => void}).gc?.()
}

/**
 * A chunk where each row carries a ~1 KB payload. 1000 rows per chunk ≈ 1 MB
 * per chunk. Used to create memory pressure detectable above Node baseline.
 */
interface FatRow {
    id: number
    payload: string
}

function makeFatRow(i: number): FatRow {
    // ~1 KB payload via a repeated character buffer
    return {id: i, payload: "x".repeat(1000)}
}

/**
 * Synthetic source yielding N chunks of `chunkSize` fat rows. Each chunk is
 * freshly allocated. Honors AbortSignal.
 */
function makeFatSource(opts: {chunks: number; chunkSize: number}): Source<FatRow, undefined> {
    return {
        async *extract(_params, signal) {
            for (let c = 0; c < opts.chunks; c++) {
                if (signal.aborted) return
                const items: FatRow[] = []
                for (let i = 0; i < opts.chunkSize; i++) {
                    items.push(makeFatRow(c * opts.chunkSize + i))
                }
                // Microtask to simulate async boundary
                await Promise.resolve()
                yield {
                    items,
                    cursor: c < opts.chunks - 1 ? `chunk-${c}` : null,
                }
            }
        },
    }
}

/**
 * Sink that drops every chunk on the floor. Forces the loop to be the only
 * thing potentially retaining references.
 */
function makeNullSink<T>(): Sink<T> {
    return {
        async load(_chunk) {
            return {loadedCount: 0}
        },
    }
}

/**
 * Returns heap delta from `baseline` in MB.
 */
function heapMb(baseline: number): number {
    return (process.memoryUsage().heapUsed - baseline) / 1024 / 1024
}

// ============================================================================
// Memory bound — the load-bearing assertion
// ============================================================================

describe("Memory: pipeline holds at most one chunk", () => {
    it(
        "100 chunks × 1000 fat rows: heap stays bounded by chunk size + overhead",
        {timeout: 60_000, skip: !hasGc ? "needs --expose-gc" : false},
        async () => {
            const CHUNKS = 100
            const CHUNK_SIZE = 1000 // ~1 MB per chunk
            // If memory were unbounded: 100 chunks × 1 MB = 100 MB resident
            // If bounded: 1 chunk + GC noise = expected < 20 MB after GC
            const BUDGET_MB = 25

            const source = makeFatSource({chunks: CHUNKS, chunkSize: CHUNK_SIZE})
            const sink = makeNullSink<FatRow>()

            // Warm up — allocate a chunk's worth of fat data so the heap is
            // sized realistically before we baseline
            for (let i = 0; i < CHUNK_SIZE; i++) makeFatRow(i)
            forceGc()
            await new Promise((r) => setImmediate(r))
            forceGc()

            const baseline = process.memoryUsage().heapUsed
            const samples: number[] = []
            let chunksProcessed = 0

            for await (const _ of runLoop(source, [], sink, undefined)) {
                chunksProcessed++
                // Sample every 10 chunks (after a GC) so we see steady-state heap
                if (chunksProcessed % 10 === 0) {
                    forceGc()
                    samples.push(heapMb(baseline))
                }
            }

            assert.strictEqual(
                chunksProcessed,
                CHUNKS,
                "loop should iterate all chunks before exit",
            )

            const maxHeap = Math.max(...samples)
            const finalHeap = samples[samples.length - 1] ?? 0

            assert.ok(
                maxHeap < BUDGET_MB,
                `max heap delta ${maxHeap.toFixed(1)}MB exceeded ${BUDGET_MB}MB budget. ` +
                    `Samples (MB): [${samples.map((s) => s.toFixed(1)).join(", ")}]. ` +
                    `This means the loop is retaining chunks — possibly via a stale ` +
                    `reference in 'current' or 'chunk' that isn't released between iterations.`,
            )
            assert.ok(
                finalHeap < BUDGET_MB,
                `final heap delta ${finalHeap.toFixed(1)}MB exceeded ${BUDGET_MB}MB. ` +
                    `If max was OK but final isn't, the loop's exit path may not release.`,
            )
        },
    )

    it(
        "Heap delta does NOT grow linearly with chunk count",
        {timeout: 60_000, skip: !hasGc ? "needs --expose-gc" : false},
        async () => {
            // Run 100 chunks. Compute heap delta at quartile points and confirm
            // they don't form a monotonic upward trend.
            const CHUNKS = 100
            const CHUNK_SIZE = 1000

            const source = makeFatSource({chunks: CHUNKS, chunkSize: CHUNK_SIZE})
            const sink = makeNullSink<FatRow>()

            forceGc()
            const baseline = process.memoryUsage().heapUsed
            const samples: number[] = []
            let chunksProcessed = 0

            for await (const _ of runLoop(source, [], sink, undefined)) {
                chunksProcessed++
                if (chunksProcessed % 25 === 0) {
                    forceGc()
                    samples.push(heapMb(baseline))
                }
            }

            // Samples at 25/50/75/100. If memory bounded, the last quartile
            // should NOT be much larger than the first.
            assert.strictEqual(samples.length, 4)
            const [q1, , , q4] = samples
            const growth = q4 - q1
            const GROWTH_BUDGET_MB = 10

            assert.ok(
                growth < GROWTH_BUDGET_MB,
                `heap grew ${growth.toFixed(1)}MB from chunk 25 to chunk 100 ` +
                    `(samples: ${samples.map((s) => s.toFixed(1)).join(", ")}MB). ` +
                    `Budget: ${GROWTH_BUDGET_MB}MB. Indicates monotonic memory growth — ` +
                    `something is accumulating per-chunk.`,
            )
        },
    )
})

// ============================================================================
// Cancellation memory — aborting mid-stream releases work-in-flight
// ============================================================================

describe("Memory: cancellation releases held chunks", () => {
    it(
        "After abort, heap returns to near baseline",
        {timeout: 30_000, skip: !hasGc ? "needs --expose-gc" : false},
        async () => {
            const CHUNK_SIZE = 1000

            const source = makeFatSource({chunks: 1000, chunkSize: CHUNK_SIZE})
            const sink = makeNullSink<FatRow>()
            const controller = new AbortController()

            forceGc()
            const baseline = process.memoryUsage().heapUsed

            let count = 0
            for await (const _ of runLoop(source, [], sink, undefined, controller.signal)) {
                count++
                if (count === 20) controller.abort()
            }

            // Force GC twice (one to collect, one to confirm)
            forceGc()
            await new Promise((r) => setImmediate(r))
            forceGc()

            const finalDelta = heapMb(baseline)
            const BUDGET_MB = 15

            assert.ok(
                finalDelta < BUDGET_MB,
                `after cancellation, heap delta ${finalDelta.toFixed(1)}MB exceeded ` +
                    `${BUDGET_MB}MB budget. The loop's references to in-flight chunks ` +
                    `may not be released on abort.`,
            )
        },
    )
})

// ============================================================================
// Transform composition memory — long transform chains don't accumulate
// ============================================================================

describe("Memory: transform composition stays bounded", () => {
    it(
        "10-transform chain over 100 chunks: same bound as 0 transforms",
        {timeout: 60_000, skip: !hasGc ? "needs --expose-gc" : false},
        async () => {
            const CHUNKS = 100
            const CHUNK_SIZE = 500

            // Identity transforms — each clones the chunk shape, preserves items
            // (forces TypeScript-level allocation per transform per chunk)
            const transforms = Array.from({length: 10}, () => (chunk: Chunk<FatRow>) => ({
                ...chunk,
                items: chunk.items.map((r) => r),
            }))

            const source = makeFatSource({chunks: CHUNKS, chunkSize: CHUNK_SIZE})
            const sink = makeNullSink<FatRow>()

            forceGc()
            const baseline = process.memoryUsage().heapUsed
            let chunksProcessed = 0

            for await (const _ of runLoop(source, transforms, sink, undefined)) {
                chunksProcessed++
            }
            forceGc()

            const finalDelta = heapMb(baseline)
            const BUDGET_MB = 30 // 1 chunk × 10 intermediates + overhead

            assert.strictEqual(chunksProcessed, CHUNKS)
            assert.ok(
                finalDelta < BUDGET_MB,
                `transform chain leaked ${finalDelta.toFixed(1)}MB (budget ${BUDGET_MB}MB). ` +
                    `One of the transforms or the loop's 'current' variable is retaining ` +
                    `intermediate chunks across iterations.`,
            )
        },
    )
})
