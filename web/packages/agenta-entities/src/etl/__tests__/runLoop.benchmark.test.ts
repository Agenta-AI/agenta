/**
 * Per-scenario latency budgets.
 *
 * Each scenario simulates a different shape of pipeline work — passthrough,
 * Tier-1 filter, Tier-2 filter, large chunks, multi-transform — and asserts
 * its median per-chunk latency stays under a declared budget.
 *
 * These budgets are deliberately generous to absorb CI variance while still
 * catching real regressions (e.g. an accidental N² loop in a transform).
 * Tighten the budgets as we get stable CI numbers.
 *
 * Failing tests print the actual numbers so the failing CI log tells you
 * which scenario regressed and by how much.
 *
 * Run via test:etl:memory (alongside memory + overhead tests).
 */

import assert from "node:assert/strict"
import {describe, it} from "node:test"

import type {Sink, Source, Transform} from "../core/types"
import {runLoop} from "../runtime/runLoop"

// ============================================================================
// Helpers
// ============================================================================

interface Row {
    id: number
    score: number
    label: string
    payload: string
}

function makeRow(i: number): Row {
    return {
        id: i,
        score: (i * 17) % 100,
        label: `row-${i}`,
        payload: "x".repeat(200),
    }
}

function makeSource(opts: {chunks: number; chunkSize: number}): Source<Row, undefined> {
    return {
        async *extract(_params, signal) {
            for (let c = 0; c < opts.chunks; c++) {
                if (signal.aborted) return
                const items: Row[] = []
                for (let i = 0; i < opts.chunkSize; i++) {
                    items.push(makeRow(c * opts.chunkSize + i))
                }
                // No await — yields synchronously so per-chunk timing is
                // dominated by transform/sink cost, not I/O simulation.
                yield {items, cursor: c < opts.chunks - 1 ? `c${c}` : null}
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

function quantile(values: number[], q: number): number {
    const sorted = [...values].sort((a, b) => a - b)
    const pos = (sorted.length - 1) * q
    const lo = Math.floor(pos)
    const hi = Math.ceil(pos)
    if (lo === hi) return sorted[lo]
    return sorted[lo] * (hi - pos) + sorted[hi] * (pos - lo)
}

// ============================================================================
// Transforms
// ============================================================================

const tier1EqFilter: Transform<Row, Row> = (chunk) => ({
    ...chunk,
    items: chunk.items.filter((r) => r.score === 50),
})

const tier1GteFilter: Transform<Row, Row> = (chunk) => ({
    ...chunk,
    items: chunk.items.filter((r) => r.score >= 50),
})

const tier2InFilter: Transform<Row, Row> = (() => {
    // Set lookup — O(1) per row but slightly more work than ===
    const allowed = new Set(["row-1", "row-50", "row-100", "row-150", "row-200"])
    return (chunk) => ({
        ...chunk,
        items: chunk.items.filter((r) => allowed.has(r.label)),
    })
})()

const mapAddField: Transform<Row, Row & {grade: string}> = (chunk) => ({
    ...chunk,
    items: chunk.items.map((r) => ({...r, grade: r.score >= 50 ? "A" : "B"})),
})

// ============================================================================
// Scenarios — each gets its own per-chunk budget
// ============================================================================

interface Scenario {
    name: string
    chunks: number
    chunkSize: number
    transforms: Transform<unknown, unknown>[]
    /** p95 per-chunk latency budget in milliseconds */
    p95BudgetMs: number
}

const SCENARIOS: Scenario[] = [
    {
        name: "passthrough — 200 rows",
        chunks: 50,
        chunkSize: 200,
        transforms: [],
        p95BudgetMs: 5,
    },
    {
        name: "tier1 eq filter — 200 rows",
        chunks: 50,
        chunkSize: 200,
        transforms: [tier1EqFilter as Transform<unknown, unknown>],
        p95BudgetMs: 5,
    },
    {
        name: "tier1 gte filter — 200 rows",
        chunks: 50,
        chunkSize: 200,
        transforms: [tier1GteFilter as Transform<unknown, unknown>],
        p95BudgetMs: 5,
    },
    {
        name: "tier2 in-set filter — 200 rows",
        chunks: 50,
        chunkSize: 200,
        transforms: [tier2InFilter as Transform<unknown, unknown>],
        p95BudgetMs: 10,
    },
    {
        name: "map transform — 200 rows",
        chunks: 50,
        chunkSize: 200,
        transforms: [mapAddField as unknown as Transform<unknown, unknown>],
        p95BudgetMs: 8,
    },
    {
        name: "large chunk — 1000 rows",
        chunks: 25,
        chunkSize: 1000,
        transforms: [tier1GteFilter as Transform<unknown, unknown>],
        p95BudgetMs: 15,
    },
    {
        name: "multi-transform chain — 5 filters on 200 rows",
        chunks: 50,
        chunkSize: 200,
        transforms: [
            tier1GteFilter as Transform<unknown, unknown>,
            tier1GteFilter as Transform<unknown, unknown>,
            tier1GteFilter as Transform<unknown, unknown>,
            tier1GteFilter as Transform<unknown, unknown>,
            tier1GteFilter as Transform<unknown, unknown>,
        ],
        p95BudgetMs: 12,
    },
]

// ============================================================================
// Runner
// ============================================================================

describe("Benchmark: per-scenario latency budgets", () => {
    for (const scenario of SCENARIOS) {
        it(`${scenario.name}: p95 < ${scenario.p95BudgetMs}ms per chunk`, async () => {
            // Warm-up run
            {
                const src = makeSource({chunks: scenario.chunks, chunkSize: scenario.chunkSize})
                const sink = makeNullSink<unknown>()
                for await (const _ of runLoop(src, scenario.transforms, sink, undefined)) {
                    // drain
                }
            }

            // Measurement run — sample per-chunk latency
            const src = makeSource({chunks: scenario.chunks, chunkSize: scenario.chunkSize})
            const sink = makeNullSink<unknown>()
            const samples: number[] = []
            let lastT = performance.now()

            for await (const _ of runLoop(src, scenario.transforms, sink, undefined)) {
                const now = performance.now()
                samples.push(now - lastT)
                lastT = now
            }

            const p50 = quantile(samples, 0.5)
            const p95 = quantile(samples, 0.95)
            const p99 = quantile(samples, 0.99)
            const max = Math.max(...samples)

            console.log(
                `\n  ${scenario.name}: ` +
                    `p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms ` +
                    `p99=${p99.toFixed(2)}ms max=${max.toFixed(2)}ms ` +
                    `(${samples.length} chunks)`,
            )

            assert.ok(
                p95 < scenario.p95BudgetMs,
                `${scenario.name}: p95 ${p95.toFixed(2)}ms exceeded ${scenario.p95BudgetMs}ms budget. ` +
                    `p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms p99=${p99.toFixed(2)}ms max=${max.toFixed(2)}ms. ` +
                    `Either the workload genuinely got slower (regression) or the budget needs tuning ` +
                    `(see __tests__/README.md).`,
            )
        })
    }
})
