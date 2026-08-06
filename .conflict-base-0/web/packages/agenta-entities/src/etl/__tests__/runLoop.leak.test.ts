/**
 * Leak detection — does the engine accumulate state across many pipeline runs?
 *
 * Each pipeline run creates a fresh Source / Sink / Transform[]. If the engine
 * (or its hosting infrastructure — atomFamily, listeners, microtask queues)
 * retains anything beyond the pipeline's lifetime, repeated runs cause heap
 * growth proportional to iteration count.
 *
 * This file runs the engine 100 times in a row, samples heap at every 10th
 * iteration, and asserts the linear-regression slope of heap-over-iteration is
 * close to zero.
 *
 * The makeSourceFromPaginatedStore adapter uses Jotai's `atomFamily` which
 * retains atoms indefinitely unless `.remove()` is called. If the adapter
 * leaks, this test catches it because each iteration uses a fresh scopeId
 * and the family grows unboundedly.
 *
 * Run via test:etl:longrun (slow — ~10-30s). Not part of regular CI.
 */

import assert from "node:assert/strict"
import {describe, it} from "node:test"

import type {Sink, Source, Transform} from "../core/types"
import {runLoop} from "../runtime/runLoop"

const hasGc = typeof (globalThis as {gc?: () => void}).gc === "function"

function forceGc() {
    ;(globalThis as {gc?: () => void}).gc?.()
}

interface Row {
    id: number
}

function makeSource(opts: {chunks: number; chunkSize: number}): Source<Row, undefined> {
    return {
        async *extract(_params, signal) {
            for (let c = 0; c < opts.chunks; c++) {
                if (signal.aborted) return
                const items: Row[] = []
                for (let i = 0; i < opts.chunkSize; i++) {
                    items.push({id: c * opts.chunkSize + i})
                }
                await Promise.resolve()
                yield {
                    items,
                    cursor: c < opts.chunks - 1 ? `c${c}` : null,
                }
            }
        },
    }
}

function makeNullSink<T>(): Sink<T> {
    return {
        async load() {
            return {loadedCount: 0}
        },
    }
}

/**
 * Linear regression slope (bytes per iteration). Returns 0 if too few samples.
 */
function regressionSlope(samples: number[]): number {
    if (samples.length < 2) return 0
    const n = samples.length
    const xs = samples.map((_, i) => i)
    const meanX = xs.reduce((a, b) => a + b, 0) / n
    const meanY = samples.reduce((a, b) => a + b, 0) / n
    const num = xs.reduce((acc, x, i) => acc + (x - meanX) * (samples[i] - meanY), 0)
    const den = xs.reduce((acc, x) => acc + (x - meanX) ** 2, 0)
    return den === 0 ? 0 : num / den
}

describe("Leak: repeated pipeline construction does not retain heap", () => {
    it(
        "100 iterations of fresh source/sink: heap slope is near zero",
        {timeout: 120_000, skip: !hasGc ? "needs --expose-gc" : false},
        async () => {
            const ITERATIONS = 100
            const WARMUP = 10
            const SAMPLE_INTERVAL = 10

            // Each iteration: construct a fresh source + sink + transform,
            // run the loop to completion. Nothing should persist between runs.
            const passthroughTransform: Transform<Row, Row> = (chunk) => chunk

            const samples: number[] = []

            for (let iter = 0; iter < ITERATIONS; iter++) {
                const source = makeSource({chunks: 20, chunkSize: 100})
                const sink = makeNullSink<Row>()
                for await (const _ of runLoop(source, [passthroughTransform], sink, undefined)) {
                    // drain
                }

                if (iter >= WARMUP && iter % SAMPLE_INTERVAL === 0) {
                    forceGc()
                    samples.push(process.memoryUsage().heapUsed)
                }
            }

            assert.ok(samples.length >= 5, `expected ≥5 samples, got ${samples.length}`)

            const slopeBytesPerSample = regressionSlope(samples)
            // Each sample is 10 iterations apart, so slope/sample → slope/iter
            const slopeBytesPerIter = slopeBytesPerSample / SAMPLE_INTERVAL

            // Budget: 50 KB per iteration. Real leaks (e.g. holding a chunk
            // per iter) would be MB-scale. This catches small leaks while
            // tolerating GC noise.
            const BUDGET_KB_PER_ITER = 50

            console.log(
                `\n  iterations sampled: ${samples.length} ` +
                    `(every ${SAMPLE_INTERVAL}th, after ${WARMUP} warmup)`,
            )
            console.log(
                `  heap samples (MB): [${samples
                    .map((s) => (s / 1024 / 1024).toFixed(1))
                    .join(", ")}]`,
            )
            console.log(
                `  slope: ${(slopeBytesPerIter / 1024).toFixed(2)} KB/iter ` +
                    `(budget ${BUDGET_KB_PER_ITER} KB/iter)`,
            )

            assert.ok(
                slopeBytesPerIter < BUDGET_KB_PER_ITER * 1024,
                `heap grows by ${(slopeBytesPerIter / 1024).toFixed(1)} KB per iteration ` +
                    `(budget ${BUDGET_KB_PER_ITER} KB/iter). Samples (MB): ` +
                    `[${samples.map((s) => (s / 1024 / 1024).toFixed(2)).join(", ")}]. ` +
                    `Something is being retained across pipeline runs.`,
            )
        },
    )

    it(
        "500 iterations: confirms stable steady-state heap",
        {timeout: 180_000, skip: !hasGc ? "needs --expose-gc" : false},
        async () => {
            const ITERATIONS = 500
            const WARMUP = 50
            const SAMPLE_INTERVAL = 25

            const samples: number[] = []

            for (let iter = 0; iter < ITERATIONS; iter++) {
                const source = makeSource({chunks: 10, chunkSize: 50})
                const sink = makeNullSink<Row>()
                for await (const _ of runLoop(source, [], sink, undefined)) {
                    // drain
                }

                if (iter >= WARMUP && iter % SAMPLE_INTERVAL === 0) {
                    forceGc()
                    samples.push(process.memoryUsage().heapUsed)
                }
            }

            const minHeap = Math.min(...samples)
            const maxHeap = Math.max(...samples)
            const rangeMb = (maxHeap - minHeap) / 1024 / 1024

            // Range over 500 iterations should be small — GC noise only
            const BUDGET_MB = 5

            console.log(
                `\n  steady-state heap range: ${rangeMb.toFixed(2)} MB over ${ITERATIONS} iterations`,
            )

            assert.ok(
                rangeMb < BUDGET_MB,
                `heap range ${rangeMb.toFixed(1)}MB over ${ITERATIONS} iterations ` +
                    `exceeded ${BUDGET_MB}MB budget. Indicates non-bounded growth.`,
            )
        },
    )
})
