#!/usr/bin/env -S node --experimental-strip-types
/**
 * ETL Engine — Smoke PoC
 *
 * Self-contained Node script demonstrating the loop engine end-to-end
 * with synthetic source, transform, and sink. Proves the architecture
 * works in Node before any backend integration.
 *
 * No backend required. Runnable today. Run with:
 *
 *   node --experimental-strip-types scripts/etl-poc-smoke.ts
 *
 * Or after `pnpm install` makes tsx available:
 *
 *   pnpm exec tsx scripts/etl-poc-smoke.ts
 *
 * Expected output: per-chunk progress lines + final summary with
 * memory growth measurement. This is what a real PoC against a
 * backend will look like — same loop, same progress shape, just
 * with synthetic data here.
 *
 * For the real-backend PoC sketched in docs/designs/etl-engine.md,
 * see (future) scripts/etl-poc.ts which adds:
 *   - scenariosPaginatedStore (Phase 1 of architecture RFC)
 *   - filterSchema + filterTransform (Phase 2)
 *   - validateFilteringAgainstSchema (D4 in filter RFC)
 *
 * This file proves the engine. The future poc.ts proves the integration.
 */

// NOTE: import paths use the .ts extension so node --experimental-strip-types
// can resolve them without a bundler. tsx-runner doesn't need the extension.
import type {Chunk, Sink, Source, Transform} from "../web/packages/agenta-entities/src/etl/core/types.ts"
import {runLoop} from "../web/packages/agenta-entities/src/etl/runtime/runLoop.ts"

// ============================================================================
// Synthetic Source — simulates paginated server responses
// ============================================================================

interface SyntheticScenario {
    id: string
    status: "completed" | "failed" | "running" | "pending"
    score: number
    label: string
}

const TOTAL_ROWS = 10_000
const CHUNK_SIZE = 200
const SIMULATED_LATENCY_MS = 80

function makeSyntheticData(count: number): SyntheticScenario[] {
    const labels = ["alpha", "beta", "gamma", "delta", "epsilon"]
    const statuses: SyntheticScenario["status"][] = ["completed", "failed", "running", "pending"]
    return Array.from({length: count}, (_, i) => ({
        id: `scenario-${i.toString().padStart(6, "0")}`,
        // ~70% completed, ~10% failed, rest running/pending
        status:
            i % 10 < 7 ? "completed" : i % 10 === 7 ? "failed" : statuses[i % statuses.length],
        score: Math.round(Math.random() * 100) / 100,
        label: labels[i % labels.length],
    }))
}

const allRows = makeSyntheticData(TOTAL_ROWS)

const syntheticSource: Source<SyntheticScenario, undefined> = {
    async *extract(_params, signal) {
        for (let offset = 0; offset < allRows.length; offset += CHUNK_SIZE) {
            if (signal.aborted) return
            // Simulate network latency
            await new Promise((r) => setTimeout(r, SIMULATED_LATENCY_MS))

            const items = allRows.slice(offset, offset + CHUNK_SIZE)
            const isLast = offset + CHUNK_SIZE >= allRows.length
            const cursor = isLast ? null : `cursor-${offset + CHUNK_SIZE}`

            yield {
                items,
                cursor,
                meta: {page: Math.floor(offset / CHUNK_SIZE), hint: "synthetic-scenarios"},
            }
        }
    },
}

// ============================================================================
// Transform — filter by status + score
// ============================================================================

const filterCompletedHighScore: Transform<SyntheticScenario, SyntheticScenario> = (chunk) => ({
    ...chunk,
    items: chunk.items.filter((s) => s.status === "completed" && s.score >= 0.8),
})

// ============================================================================
// Sink — accumulates matched rows (simulates V-table viewport)
// ============================================================================

const matchedRows: SyntheticScenario[] = []
let finalizedRan = false

const viewportSink: Sink<SyntheticScenario> = {
    async load(chunk) {
        matchedRows.push(...chunk.items)
        return {loadedCount: chunk.items.length}
    },
    async finalize() {
        finalizedRan = true
    },
}

// ============================================================================
// Run the pipeline
// ============================================================================

async function main() {
    console.log("=== ETL Engine Smoke PoC ===")
    console.log(`Total rows: ${TOTAL_ROWS}`)
    console.log(`Chunk size: ${CHUNK_SIZE}`)
    console.log(`Simulated per-chunk latency: ${SIMULATED_LATENCY_MS}ms`)
    console.log(`Predicate: status === "completed" AND score >= 0.8`)
    console.log("")

    const startMem = process.memoryUsage().heapUsed
    const startTime = Date.now()
    let chunkCount = 0
    const VIEWPORT_TARGET = 20

    const abort = new AbortController()

    for await (const progress of runLoop(
        syntheticSource,
        [filterCompletedHighScore],
        viewportSink,
        undefined,
        abort.signal,
    )) {
        chunkCount++
        const elapsed = Date.now() - startTime
        const memMB = (process.memoryUsage().heapUsed - startMem) / 1024 / 1024
        console.log(
            `chunk ${chunkCount.toString().padStart(3)}: ` +
                `scanned=${progress.scanned.toString().padStart(5)} ` +
                `matched=${progress.matched.toString().padStart(4)} ` +
                `loaded=${progress.loaded.toString().padStart(4)} ` +
                `elapsed=${elapsed.toString().padStart(5)}ms ` +
                `heap=+${memMB.toFixed(1)}MB`,
        )

        // Realistic viewport-cancel: stop once we have enough matches
        if (progress.matched >= VIEWPORT_TARGET) {
            console.log(`\n→ viewport filled (${VIEWPORT_TARGET} matches); aborting`)
            abort.abort()
            break
        }
    }

    const totalElapsed = Date.now() - startTime
    const totalMemMB = (process.memoryUsage().heapUsed - startMem) / 1024 / 1024

    console.log("")
    console.log("--- final ---")
    console.log(`chunks processed: ${chunkCount}`)
    console.log(`total elapsed: ${totalElapsed}ms`)
    console.log(`matched rows accumulated: ${matchedRows.length}`)
    console.log(`heap growth: ${totalMemMB.toFixed(1)}MB`)
    console.log(`sink.finalize ran: ${finalizedRan}`)
    console.log("")

    // Sanity assertions — these verify the engine's guarantees held
    const assertions: Array<[string, boolean]> = [
        ["finalize ran via finally block", finalizedRan],
        ["matched count ≥ viewport target", matchedRows.length >= VIEWPORT_TARGET],
        ["did not process all chunks (cancellation worked)", chunkCount < TOTAL_ROWS / CHUNK_SIZE],
        ["all matched rows satisfy predicate", matchedRows.every((r) => r.status === "completed" && r.score >= 0.8)],
        ["heap growth is bounded (< 50 MB for this scale)", totalMemMB < 50],
    ]

    console.log("--- assertions ---")
    let allOk = true
    for (const [name, ok] of assertions) {
        console.log(`${ok ? "✓" : "✗"} ${name}`)
        if (!ok) allOk = false
    }

    if (!allOk) {
        console.error("\nFAILED")
        process.exit(1)
    }
    console.log("\nOK — engine guarantees satisfied")
}

main().catch((e) => {
    console.error("Unexpected error:", e)
    process.exit(1)
})
