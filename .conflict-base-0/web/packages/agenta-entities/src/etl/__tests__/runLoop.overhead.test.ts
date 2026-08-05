/**
 * Engine overhead — what's the cost of `runLoop` vs a hand-written loop?
 *
 * The engine adds yield events, AbortSignal checks, finalize handling, and a
 * try/finally wrapper. None should add significant overhead, but "significant"
 * needs a number. This file pins it down.
 *
 * Compares two implementations doing the same work:
 *   1. Baseline: hand-written async iteration over the source, filter, sink
 *   2. Engine: same work through runLoop
 *
 * Asserts engine overhead < BUDGET (currently 25% — generous to absorb CI
 * variance; tighten as we get steady CI numbers).
 *
 * Run:
 *   pnpm --filter @agenta/entities test:etl:memory
 */

import assert from "node:assert/strict"
import {describe, it} from "node:test"

import type {Chunk, Sink, Source, Transform} from "../core/types"
import {runLoop} from "../runtime/runLoop"

// ============================================================================
// Synthetic workload — kept small so test runs in seconds
// ============================================================================

interface Row {
    id: number
    score: number
}

function makeSource(opts: {chunks: number; chunkSize: number}): Source<Row, undefined> {
    return {
        async *extract(_params, signal) {
            for (let c = 0; c < opts.chunks; c++) {
                if (signal.aborted) return
                const items: Row[] = []
                for (let i = 0; i < opts.chunkSize; i++) {
                    items.push({id: c * opts.chunkSize + i, score: (i * 17) % 100})
                }
                // Yield to event loop so timing is comparable to real async
                await Promise.resolve()
                yield {
                    items,
                    cursor: c < opts.chunks - 1 ? `c${c}` : null,
                }
            }
        },
    }
}

const filterScoreGte50: Transform<Row, Row> = (chunk) => ({
    ...chunk,
    items: chunk.items.filter((r) => r.score >= 50),
})

function makeAccumulatorSink(): Sink<Row> & {received: number} {
    const sink = {
        received: 0,
        async load(chunk: Chunk<Row>) {
            sink.received += chunk.items.length
            return {loadedCount: chunk.items.length}
        },
    }
    return sink
}

// ============================================================================
// Baseline: hand-written equivalent of runLoop
// ============================================================================

async function baselineLoop(
    source: Source<Row, undefined>,
    transform: Transform<Row, Row>,
    sink: Sink<Row>,
): Promise<{scanned: number; matched: number; loaded: number}> {
    const abort = new AbortController().signal
    let scanned = 0
    let matched = 0
    let loaded = 0

    for await (const chunk of source.extract(undefined, abort)) {
        scanned += chunk.items.length
        const out = await transform(chunk)
        matched += out.items.length
        if (out.items.length > 0) {
            const r = await sink.load(out)
            loaded += r.loadedCount ?? out.items.length
        }
    }

    return {scanned, matched, loaded}
}

// ============================================================================
// Timing helper
// ============================================================================

async function timeMs(fn: () => Promise<unknown>): Promise<number> {
    const start = performance.now()
    await fn()
    return performance.now() - start
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b)
    const mid = sorted.length >> 1
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

// ============================================================================
// Overhead test
// ============================================================================

describe("Overhead: runLoop vs hand-written equivalent", () => {
    it("engine overhead median is < 25% over baseline", {timeout: 60_000}, async () => {
        // Workload size chosen so each run takes 50-200ms (enough signal
        // to measure, fast enough that CI doesn't time out)
        const CHUNKS = 200
        const CHUNK_SIZE = 500
        const ITERATIONS = 5 // 5 runs of each, take median

        // Warm-up: run each once before timing (JIT, allocator priming)
        {
            const src = makeSource({chunks: CHUNKS, chunkSize: CHUNK_SIZE})
            await baselineLoop(src, filterScoreGte50, makeAccumulatorSink())
        }
        {
            const src = makeSource({chunks: CHUNKS, chunkSize: CHUNK_SIZE})
            const sink = makeAccumulatorSink()
            for await (const _ of runLoop(src, [filterScoreGte50], sink, undefined)) {
                // drain
            }
        }

        // Measure baseline
        const baselineSamples: number[] = []
        for (let i = 0; i < ITERATIONS; i++) {
            const src = makeSource({chunks: CHUNKS, chunkSize: CHUNK_SIZE})
            const sink = makeAccumulatorSink()
            baselineSamples.push(
                await timeMs(async () => {
                    await baselineLoop(src, filterScoreGte50, sink)
                }),
            )
        }

        // Measure engine
        const engineSamples: number[] = []
        for (let i = 0; i < ITERATIONS; i++) {
            const src = makeSource({chunks: CHUNKS, chunkSize: CHUNK_SIZE})
            const sink = makeAccumulatorSink()
            engineSamples.push(
                await timeMs(async () => {
                    for await (const _ of runLoop(src, [filterScoreGte50], sink, undefined)) {
                        // drain
                    }
                }),
            )
        }

        const baselineMed = median(baselineSamples)
        const engineMed = median(engineSamples)
        const overheadPct = ((engineMed - baselineMed) / baselineMed) * 100
        const BUDGET_PCT = 25

        // Report findings even on pass — useful in CI logs
        console.log(
            `\n  baseline median: ${baselineMed.toFixed(2)}ms ` +
                `[${baselineSamples.map((s) => s.toFixed(1)).join(", ")}]`,
        )
        console.log(
            `  engine median:   ${engineMed.toFixed(2)}ms ` +
                `[${engineSamples.map((s) => s.toFixed(1)).join(", ")}]`,
        )
        console.log(`  overhead:        ${overheadPct.toFixed(1)}% (budget ${BUDGET_PCT}%)`)

        assert.ok(
            overheadPct < BUDGET_PCT,
            `engine overhead ${overheadPct.toFixed(1)}% exceeded ${BUDGET_PCT}% budget. ` +
                `Baseline median ${baselineMed.toFixed(1)}ms, engine median ${engineMed.toFixed(1)}ms. ` +
                `Check the loop for accidental work in the hot path (extra awaits, allocations).`,
        )
    })

    it("engine processes the same row counts as baseline", async () => {
        const CHUNKS = 50
        const CHUNK_SIZE = 200

        const src1 = makeSource({chunks: CHUNKS, chunkSize: CHUNK_SIZE})
        const sink1 = makeAccumulatorSink()
        const baselineResult = await baselineLoop(src1, filterScoreGte50, sink1)

        const src2 = makeSource({chunks: CHUNKS, chunkSize: CHUNK_SIZE})
        const sink2 = makeAccumulatorSink()
        let engineScanned = 0
        let engineMatched = 0
        let engineLoaded = 0
        for await (const progress of runLoop(src2, [filterScoreGte50], sink2, undefined)) {
            engineScanned = progress.scanned
            engineMatched = progress.matched
            engineLoaded = progress.loaded
        }

        assert.strictEqual(
            engineScanned,
            baselineResult.scanned,
            `engine scanned ${engineScanned} but baseline scanned ${baselineResult.scanned}`,
        )
        assert.strictEqual(
            engineMatched,
            baselineResult.matched,
            `engine matched ${engineMatched} but baseline matched ${baselineResult.matched}`,
        )
        assert.strictEqual(
            engineLoaded,
            baselineResult.loaded,
            `engine loaded ${engineLoaded} but baseline loaded ${baselineResult.loaded}`,
        )
        assert.strictEqual(sink1.received, sink2.received, "sinks received different counts")
    })
})
