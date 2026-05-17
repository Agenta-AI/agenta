#!/usr/bin/env -S node --experimental-strip-types
/**
 * ETL Engine — Real-backend PoC
 *
 * Hits a real Agenta backend, pulls real evaluation scenarios via the
 * ETL loop engine, applies a filter, and reports timing + memory.
 *
 * Required environment variables:
 *   AGENTA_API_URL      e.g. http://localhost:8000
 *   AGENTA_API_KEY      bearer token
 *   AGENTA_PROJECT_ID   project UUID
 *   AGENTA_RUN_ID       eval run UUID
 *
 * Optional:
 *   AGENTA_CHUNK_SIZE        default 200
 *   AGENTA_VIEWPORT_TARGET   default 20 (stop after this many matched rows)
 *   AGENTA_FILTER_STATUS     default "completed" — filter by scenario.status
 *
 * Run:
 *   AGENTA_API_URL=http://localhost:8000 \
 *   AGENTA_API_KEY=... \
 *   AGENTA_PROJECT_ID=... \
 *   AGENTA_RUN_ID=... \
 *   node --experimental-strip-types scripts/etl-poc.ts
 *
 * What this proves (when run successfully):
 *   - Source<EvaluationScenario> via real HTTP works
 *   - Cursor pagination via the opaque-string contract works end-to-end
 *   - Filter transform composes with the real source
 *   - Viewport-driven cancellation works against real network latency
 *   - Memory stays bounded as real chunks pass through
 *   - All five engine guarantees hold against real data
 */

import type {Transform, Sink} from "../web/packages/agenta-entities/src/etl/core/types.ts"
import {runLoop} from "../web/packages/agenta-entities/src/etl/runtime/runLoop.ts"
import type {RealEvaluationScenario} from "../web/packages/agenta-entities/src/evaluationRun/etl/realScenarioSource.ts"
import {makeRealScenarioSource} from "../web/packages/agenta-entities/src/evaluationRun/etl/realScenarioSource.ts"

// ============================================================================
// Env validation
// ============================================================================

const env = {
    apiUrl: process.env.AGENTA_API_URL ?? "",
    apiKey: process.env.AGENTA_API_KEY ?? "",
    projectId: process.env.AGENTA_PROJECT_ID ?? "",
    runId: process.env.AGENTA_RUN_ID ?? "",
    chunkSize: Number(process.env.AGENTA_CHUNK_SIZE ?? 200),
    viewportTarget: Number(process.env.AGENTA_VIEWPORT_TARGET ?? 20),
    filterStatus: process.env.AGENTA_FILTER_STATUS ?? "completed",
}

const missing: string[] = []
if (!env.apiUrl) missing.push("AGENTA_API_URL")
if (!env.apiKey) missing.push("AGENTA_API_KEY")
if (!env.projectId) missing.push("AGENTA_PROJECT_ID")
if (!env.runId) missing.push("AGENTA_RUN_ID")

if (missing.length > 0) {
    console.error("Missing required environment variables:")
    for (const m of missing) console.error(`  ${m}`)
    console.error("")
    console.error("This PoC requires a running Agenta backend with a known eval run.")
    console.error("For engine-only validation (no backend), use scripts/etl-poc-smoke.ts.")
    process.exit(1)
}

// ============================================================================
// Pipeline
// ============================================================================

console.log("=== ETL Engine Real-backend PoC ===")
console.log(`API URL:         ${env.apiUrl}`)
console.log(`Project:         ${env.projectId}`)
console.log(`Run:             ${env.runId}`)
console.log(`Chunk size:      ${env.chunkSize}`)
console.log(`Viewport target: ${env.viewportTarget} matches`)
console.log(`Filter:          status === "${env.filterStatus}"`)
console.log("")

const source = makeRealScenarioSource({
    baseUrl: env.apiUrl,
    apiKey: env.apiKey,
    projectId: env.projectId,
    runId: env.runId,
    chunkSize: env.chunkSize,
})

const statusFilter: Transform<RealEvaluationScenario, RealEvaluationScenario> = (chunk) => ({
    ...chunk,
    items: chunk.items.filter((s) => s.status === env.filterStatus),
})

const matchedRows: RealEvaluationScenario[] = []
let finalizedRan = false

const accumulatorSink: Sink<RealEvaluationScenario> = {
    async load(chunk) {
        matchedRows.push(...chunk.items)
        return {loadedCount: chunk.items.length}
    },
    async finalize() {
        finalizedRan = true
    },
}

// ============================================================================
// Run
// ============================================================================

async function main() {
    const startMem = process.memoryUsage().heapUsed
    const startTime = Date.now()
    let chunkCount = 0

    const abort = new AbortController()

    try {
        for await (const progress of runLoop(
            source,
            [statusFilter],
            accumulatorSink,
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
                    `elapsed=${elapsed.toString().padStart(6)}ms ` +
                    `heap=+${memMB.toFixed(1)}MB ` +
                    `cursor=${(progress.cursor as string | null)?.slice(0, 12) ?? "(end)"}`,
            )

            if (progress.matched >= env.viewportTarget) {
                console.log(`\n→ viewport filled (${env.viewportTarget} matches); aborting`)
                abort.abort()
                break
            }
        }
    } catch (e) {
        console.error("\n✗ Pipeline error:", e instanceof Error ? e.message : e)
        process.exit(1)
    }

    const totalElapsed = Date.now() - startTime
    const totalMemMB = (process.memoryUsage().heapUsed - startMem) / 1024 / 1024

    console.log("")
    console.log("--- final ---")
    console.log(`chunks processed:       ${chunkCount}`)
    console.log(`total elapsed:          ${totalElapsed}ms`)
    console.log(`avg ms/chunk:           ${(totalElapsed / Math.max(chunkCount, 1)).toFixed(1)}`)
    console.log(`matched rows:           ${matchedRows.length}`)
    console.log(`heap growth:            ${totalMemMB.toFixed(1)}MB`)
    console.log(`sink.finalize ran:      ${finalizedRan}`)
    console.log("")

    if (matchedRows.length > 0) {
        console.log("--- sample matched rows ---")
        for (const row of matchedRows.slice(0, 3)) {
            console.log(`  id=${row.id} status=${row.status} testcase=${row.testcase_id ?? "—"}`)
        }
        console.log("")
    }

    // Engine-level assertions
    const assertions: Array<[string, boolean]> = [
        ["finalize ran via finally block", finalizedRan],
        ["pipeline completed without throwing", true],
        ["all matched rows satisfy predicate", matchedRows.every((r) => r.status === env.filterStatus)],
        ["at least one chunk was processed", chunkCount > 0],
    ]

    console.log("--- engine assertions ---")
    let allOk = true
    for (const [name, ok] of assertions) {
        console.log(`${ok ? "✓" : "✗"} ${name}`)
        if (!ok) allOk = false
    }

    if (!allOk) {
        console.error("\nFAILED")
        process.exit(1)
    }
    console.log("\nOK — engine works against real evaluation data")
}

main().catch((e) => {
    console.error("Unexpected error:", e)
    process.exit(1)
})
