/**
 * Engine guarantees — 5 tests, one per documented guarantee.
 *
 * Runnable in Node with no environmental setup beyond the workspace's
 * existing `tsx` binary. Uses Node's built-in `node:test` runner (no
 * vitest/jest dep). Run with:
 *
 *   pnpm --filter @agenta/entities test:etl
 *
 * or directly:
 *
 *   pnpm exec tsx --test src/etl/__tests__/runLoop.guarantees.test.ts
 */

import assert from "node:assert/strict"
import {describe, it, mock} from "node:test"

import type {Chunk, Sink, Source, Transform} from "../core/types"
import {runLoop} from "../runtime/runLoop"

// ============================================================================
// Test helpers
// ============================================================================

/**
 * A fake Source that yields N pre-built chunks. Honors AbortSignal.
 */
function makeFakeSource<T>(chunks: Chunk<T>[]): Source<T, undefined> {
    return {
        async *extract(_params, signal) {
            for (const chunk of chunks) {
                if (signal.aborted) return
                // Microtask boundary to simulate I/O
                await Promise.resolve()
                yield chunk
            }
        },
    }
}

interface RecordingSink<T> extends Sink<T> {
    recorded: T[]
    finalized: boolean
}

/**
 * A fake Sink that records each chunk's items into an array.
 */
function makeRecordingSink<T>(): RecordingSink<T> {
    const recorded: T[] = []
    const sink: RecordingSink<T> = {
        recorded,
        finalized: false,
        async load(chunk) {
            recorded.push(...chunk.items)
            return {loadedCount: chunk.items.length}
        },
        async finalize() {
            sink.finalized = true
        },
    }
    return sink
}

// ============================================================================
// Guarantee 1 — Pipeline memory bounded by chunk size
// ============================================================================

describe("Guarantee 1: pipeline memory bounded by chunk size", () => {
    it("processes chunks one at a time; transform sees only the current chunk", async () => {
        const chunkSizes: number[] = []
        const captureChunkSize: Transform<number, number> = (chunk) => {
            chunkSizes.push(chunk.items.length)
            return chunk
        }

        const source = makeFakeSource<number>([
            {items: [1, 2, 3], cursor: "c1"},
            {items: [4, 5, 6], cursor: "c2"},
            {items: [7, 8, 9], cursor: null},
        ])
        const sink = makeRecordingSink<number>()

        for await (const _ of runLoop(source, [captureChunkSize], sink, undefined)) {
            // Iterate to completion
        }

        // Three chunks of three items each — never sees all 9 at once
        assert.deepStrictEqual(chunkSizes, [3, 3, 3])
        assert.deepStrictEqual(sink.recorded, [1, 2, 3, 4, 5, 6, 7, 8, 9])
    })
})

// ============================================================================
// Guarantee 2 — Cancellation through the loop body
// ============================================================================

describe("Guarantee 2: cancellation via AbortSignal", () => {
    it("stops iteration when signal aborts mid-stream", async () => {
        const source = makeFakeSource<number>([
            {items: [1], cursor: "c1"},
            {items: [2], cursor: "c2"},
            {items: [3], cursor: "c3"},
            {items: [4], cursor: null},
        ])
        const sink = makeRecordingSink<number>()
        const controller = new AbortController()

        let count = 0
        for await (const _progress of runLoop(source, [], sink, undefined, controller.signal)) {
            count++
            if (count === 2) controller.abort()
        }

        // Iteration stops after second chunk; chunks 3 and 4 never load
        assert.deepStrictEqual(sink.recorded, [1, 2])
        assert.strictEqual(count, 2)
    })

    it("still runs finalize on the sink when cancelled", async () => {
        const source = makeFakeSource<number>([
            {items: [1], cursor: "c1"},
            {items: [2], cursor: null},
        ])
        const sink = makeRecordingSink<number>()
        const controller = new AbortController()
        controller.abort() // Abort before iteration starts

        for await (const _ of runLoop(source, [], sink, undefined, controller.signal)) {
            // No iterations expected
        }

        assert.strictEqual(sink.finalized, true)
    })
})

// ============================================================================
// Guarantee 3 — Progress is observable
// ============================================================================

describe("Guarantee 3: progress yielded per chunk", () => {
    it("yields Progress after every chunk with running counters", async () => {
        const source = makeFakeSource<number>([
            {items: [1, 2], cursor: "c1"},
            {items: [3, 4, 5], cursor: "c2"},
            {items: [6], cursor: null},
        ])
        const dropOdds: Transform<number, number> = (chunk) => ({
            ...chunk,
            items: chunk.items.filter((n) => n % 2 === 0),
        })
        const sink = makeRecordingSink<number>()

        const progressEvents: {scanned: number; matched: number; loaded: number}[] = []
        for await (const progress of runLoop(source, [dropOdds], sink, undefined)) {
            progressEvents.push({
                scanned: progress.scanned,
                matched: progress.matched,
                loaded: progress.loaded,
            })
        }

        // Running totals per chunk:
        //   chunk 1: scanned=2, matched=1 (just 2), loaded=1
        //   chunk 2: scanned=5, matched=2 (4), loaded=2
        //   chunk 3: scanned=6, matched=3 (6), loaded=3
        assert.deepStrictEqual(progressEvents, [
            {scanned: 2, matched: 1, loaded: 1},
            {scanned: 5, matched: 2, loaded: 2},
            {scanned: 6, matched: 3, loaded: 3},
        ])
        assert.deepStrictEqual(sink.recorded, [2, 4, 6])
    })
})

// ============================================================================
// Guarantee 4 — Backpressure is natural
// ============================================================================

describe("Guarantee 4: backpressure via await sink.load", () => {
    it("blocks the loop while sink.load is in flight", async () => {
        const source = makeFakeSource<number>([
            {items: [1], cursor: "c1"},
            {items: [2], cursor: "c2"},
            {items: [3], cursor: null},
        ])

        const loadStart: number[] = []
        const loadEnd: number[] = []
        const slowSink: Sink<number> = {
            async load(chunk) {
                loadStart.push(performance.now())
                await new Promise((r) => setTimeout(r, 30))
                loadEnd.push(performance.now())
                return {loadedCount: chunk.items.length}
            },
        }

        for await (const _ of runLoop(source, [], slowSink, undefined)) {
            // Iterate to completion
        }

        // Each load completes before the next starts
        assert.strictEqual(loadStart.length, 3)
        assert.strictEqual(loadEnd.length, 3)
        for (let i = 1; i < 3; i++) {
            assert.ok(
                loadStart[i] >= loadEnd[i - 1],
                `load ${i} started at ${loadStart[i]} before previous load ended at ${loadEnd[i - 1]}`,
            )
        }
    })
})

// ============================================================================
// Guarantee 5 — Cleanup runs on every exit path
// ============================================================================

describe("Guarantee 5: sink.finalize runs in finally", () => {
    it("runs finalize on normal completion", async () => {
        const source = makeFakeSource<number>([{items: [1], cursor: null}])
        const sink = makeRecordingSink<number>()
        for await (const _ of runLoop(source, [], sink, undefined)) {
            // Iterate to completion
        }
        assert.strictEqual(sink.finalized, true)
    })

    it("runs finalize even when a transform throws", async () => {
        const source = makeFakeSource<number>([
            {items: [1], cursor: "c1"},
            {items: [2], cursor: null},
        ])
        const sink = makeRecordingSink<number>()
        const boom: Transform<number, number> = () => {
            throw new Error("transform boom")
        }

        await assert.rejects(async () => {
            for await (const _ of runLoop(source, [boom], sink, undefined)) {
                // Should throw before any iteration completes
            }
        }, /transform boom/)

        // Critical: finalize still ran via the try/finally in runLoop
        assert.strictEqual(sink.finalized, true)
    })

    it("runs finalize when source throws mid-stream", async () => {
        const failingSource: Source<number, undefined> = {
            async *extract() {
                yield {items: [1], cursor: "c1"}
                throw new Error("source boom")
            },
        }
        const sink = makeRecordingSink<number>()

        await assert.rejects(async () => {
            for await (const _ of runLoop(failingSource, [], sink, undefined)) {
                // First iteration yields, then source throws
            }
        }, /source boom/)

        assert.deepStrictEqual(sink.recorded, [1])
        assert.strictEqual(sink.finalized, true)
    })
})

// ============================================================================
// Bonus: short-circuit on empty
// ============================================================================

describe("Behavior: short-circuit on empty chunk", () => {
    it("skips subsequent transforms when an upstream transform empties the chunk", async () => {
        const source = makeFakeSource<number>([{items: [1, 2, 3], cursor: null}])
        const emptyAll: Transform<number, number> = (chunk) => ({...chunk, items: []})
        const downstreamMock = mock.fn((chunk: Chunk<number>) => chunk)
        const downstream: Transform<number, number> = downstreamMock
        const sink = makeRecordingSink<number>()

        for await (const _ of runLoop(source, [emptyAll, downstream], sink, undefined)) {
            // Iterate to completion
        }

        assert.strictEqual(downstreamMock.mock.callCount(), 0)
        assert.deepStrictEqual(sink.recorded, [])
    })
})
