/**
 * Leak detection for molecule prefetch actions.
 *
 * The pure-engine leak test (etl/__tests__/runLoop.leak.test.ts) covers the
 * runtime — Source/Transform/Sink with synthetic data. It does NOT cover the
 * entity-cache layer we wired in (result/metric/testcase/trace prefetch
 * actions backed by TanStack Query).
 *
 * Two distinct risks to test here:
 *
 *   1. **Unbounded cache growth across runs.** Each call to
 *      `prefetchByScenarioIds` adds a TanStack entry per scenario. Without
 *      explicit eviction, entries persist for the process lifetime. We
 *      verify that `evictByRunId` returns the cache to baseline size,
 *      and that heap stabilizes when we cycle through fresh runs with
 *      eviction between each.
 *
 *   2. **Cache write-back doesn't compound.** When the same scenarios are
 *      re-prefetched (100% hit), the cache size MUST stay the same — not
 *      grow. We verify this directly.
 *
 * Run via: pnpm test:etl:longrun  (slow; needs --expose-gc to be reliable).
 */

import assert from "node:assert/strict"
import {describe, it} from "node:test"

// QueryClient is re-exported from @tanstack/react-query (a workspace peer
// dep). The bare @tanstack/query-core also exposes it but doesn't resolve
// under `node --import tsx --test` (the script used by test:etl:longrun).
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai/vanilla"
import {queryClientAtom} from "jotai-tanstack-query"

import type {EvaluationMetric, EvaluationResult} from "../../core"
import {inspectCache} from "../../etl/cacheDiagnostics"
import {evaluationMetricMolecule} from "../metricMolecule"
import {evaluationResultMolecule} from "../resultMolecule"

const hasGc = typeof (globalThis as {gc?: () => void}).gc === "function"
const forceGc = () => (globalThis as {gc?: () => void}).gc?.()

const store = getDefaultStore()

function installQc(): QueryClient {
    const qc = new QueryClient({
        defaultOptions: {queries: {retry: false, gcTime: Infinity, staleTime: Infinity}},
    })
    store.set(queryClientAtom, qc)
    return qc
}

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

// =============================================================================
// Risk 1: rerunning the same prefetch does NOT grow cache
// =============================================================================

describe("Leak: repeated prefetch of same scenarios doesn't grow cache", () => {
    it("100 rerolls with the SAME scenario IDs → cache size constant", async () => {
        const qc = installQc()
        // Pre-populate the cache so the prefetches go full-hit. No api stubs
        // needed — we're testing the cache-read path, not the network path.
        for (let i = 0; i < 100; i++) {
            qc.setQueryData(["evaluation-results", "p1", "run1", `s${i}`], [
                {run_id: "run1", scenario_id: `s${i}`, step_key: "step-a", status: "ok"},
            ] as EvaluationResult[])
            qc.setQueryData(["evaluation-metrics", "p1", "run1", `s${i}`], [
                {id: `m${i}`, run_id: "run1", scenario_id: `s${i}`, status: "ok"},
            ] as unknown as EvaluationMetric[])
        }
        const scenarioIds = Array.from({length: 100}, (_, i) => `s${i}`)

        const baseline = inspectCache({prefixes: ["evaluation-results", "evaluation-metrics"]})

        for (let i = 0; i < 100; i++) {
            await evaluationResultMolecule.actions.prefetchByScenarioIds({
                projectId: "p1",
                runId: "run1",
                scenarioIds,
            })
            await evaluationMetricMolecule.actions.prefetchByScenarioIds({
                projectId: "p1",
                runId: "run1",
                scenarioIds,
            })
        }

        const after = inspectCache({prefixes: ["evaluation-results", "evaluation-metrics"]})

        assert.equal(after.totalEntries, baseline.totalEntries, "rerun must not add entries")
        assert.equal(
            after.totalApproxBytes,
            baseline.totalApproxBytes,
            "rerun must not change byte size",
        )
    })
})

// =============================================================================
// Risk 2: evictByRunId returns the cache to baseline
// =============================================================================

describe("Leak: evictByRunId fully releases run-scoped cache entries", () => {
    it("populate → evict → cache is baseline-empty", () => {
        const qc = installQc()
        for (let i = 0; i < 200; i++) {
            qc.setQueryData(["evaluation-results", "p1", "run1", `s${i}`], [
                {run_id: "run1", scenario_id: `s${i}`, step_key: "x", status: "ok"},
            ] as EvaluationResult[])
            qc.setQueryData(["evaluation-metrics", "p1", "run1", `s${i}`], [
                {id: `m${i}`, run_id: "run1", scenario_id: `s${i}`, status: "ok"},
            ] as unknown as EvaluationMetric[])
        }

        const before = inspectCache({prefixes: ["evaluation-results", "evaluation-metrics"]})
        assert.equal(before.totalEntries, 400)

        const removedResults = evaluationResultMolecule.actions.evictByRunId({
            projectId: "p1",
            runId: "run1",
        })
        const removedMetrics = evaluationMetricMolecule.actions.evictByRunId({
            projectId: "p1",
            runId: "run1",
        })

        assert.equal(removedResults, 200)
        assert.equal(removedMetrics, 200)

        const after = inspectCache({prefixes: ["evaluation-results", "evaluation-metrics"]})
        assert.equal(after.totalEntries, 0, "evict must clear everything for the run")
    })

    it("evictByRunId is run-scoped — other runs untouched", () => {
        const qc = installQc()
        // Two runs in the same project
        qc.setQueryData(
            ["evaluation-results", "p1", "runA", "s1"],
            [{run_id: "runA"} as EvaluationResult],
        )
        qc.setQueryData(
            ["evaluation-results", "p1", "runB", "s1"],
            [{run_id: "runB"} as EvaluationResult],
        )

        const removed = evaluationResultMolecule.actions.evictByRunId({
            projectId: "p1",
            runId: "runA",
        })
        assert.equal(removed, 1)

        // runB still cached
        const runB = evaluationResultMolecule.get.byScenario({
            projectId: "p1",
            runId: "runB",
            scenarioId: "s1",
        })
        assert.ok(runB, "runB cache survives runA eviction")
        const runA = evaluationResultMolecule.get.byScenario({
            projectId: "p1",
            runId: "runA",
            scenarioId: "s1",
        })
        assert.equal(runA, null, "runA cache cleared")
    })
})

// =============================================================================
// Risk 3: long-run iterations with eviction → heap stable
// =============================================================================

describe("Leak: 100 fresh-run iterations with evict-between → heap slope ~zero", () => {
    it(
        "heap should not grow linearly when caller dutifully evicts after each run",
        {timeout: 60_000, skip: !hasGc ? "needs --expose-gc" : false},
        async () => {
            installQc()
            const ITERATIONS = 100
            const SCENARIOS_PER_RUN = 50
            const WARMUP = 10
            const SAMPLE_INTERVAL = 10

            const samples: number[] = []

            for (let iter = 0; iter < ITERATIONS; iter++) {
                const runId = `run-${iter}`
                const scenarioIds = Array.from(
                    {length: SCENARIOS_PER_RUN},
                    (_, i) => `s-${iter}-${i}`,
                )
                // Seed the cache directly (no network) — simulates the
                // prefetch action writing back after fetching misses.
                const qc = store.get(queryClientAtom)
                for (const sid of scenarioIds) {
                    qc.setQueryData(["evaluation-results", "p1", runId, sid], [
                        {run_id: runId, scenario_id: sid, step_key: "x", status: "ok"},
                    ] as EvaluationResult[])
                    qc.setQueryData(["evaluation-metrics", "p1", runId, sid], [
                        {id: sid, run_id: runId, scenario_id: sid, status: "ok"},
                    ] as unknown as EvaluationMetric[])
                }

                // Read everything back via the molecule (exercises the cache-hit path)
                await evaluationResultMolecule.actions.prefetchByScenarioIds({
                    projectId: "p1",
                    runId,
                    scenarioIds,
                })
                await evaluationMetricMolecule.actions.prefetchByScenarioIds({
                    projectId: "p1",
                    runId,
                    scenarioIds,
                })

                // Evict, mimicking what a well-behaved ETL caller would do
                evaluationResultMolecule.actions.evictByRunId({projectId: "p1", runId})
                evaluationMetricMolecule.actions.evictByRunId({projectId: "p1", runId})

                if (iter >= WARMUP && iter % SAMPLE_INTERVAL === 0) {
                    forceGc()
                    samples.push(process.memoryUsage().heapUsed)
                }
            }

            assert.ok(samples.length >= 5, `expected ≥5 samples, got ${samples.length}`)
            const slopeBytesPerSample = regressionSlope(samples)
            const slopeBytesPerIter = slopeBytesPerSample / SAMPLE_INTERVAL

            // Budget: 100 KB per iteration. A real leak (e.g. holding all
            // scenarios in heap across iterations) would be MB-scale.
            const BUDGET_KB_PER_ITER = 100

            console.log(
                `\n  samples (MB): [${samples.map((s) => (s / 1024 / 1024).toFixed(1)).join(", ")}]`,
            )
            console.log(
                `  slope: ${(slopeBytesPerIter / 1024).toFixed(2)} KB/iter (budget ${BUDGET_KB_PER_ITER} KB/iter)`,
            )

            assert.ok(
                slopeBytesPerIter < BUDGET_KB_PER_ITER * 1024,
                `heap grows ${(slopeBytesPerIter / 1024).toFixed(1)} KB/iter (budget ${BUDGET_KB_PER_ITER} KB). Eviction not releasing memory.`,
            )
        },
    )

    it(
        "WITHOUT eviction: heap DOES grow (sanity check — proves eviction is load-bearing)",
        {timeout: 60_000, skip: !hasGc ? "needs --expose-gc" : false},
        async () => {
            installQc()
            const ITERATIONS = 50
            const SCENARIOS_PER_RUN = 50

            const baselineSize = (() => {
                forceGc()
                return process.memoryUsage().heapUsed
            })()

            for (let iter = 0; iter < ITERATIONS; iter++) {
                const runId = `run-leak-${iter}`
                const scenarioIds = Array.from(
                    {length: SCENARIOS_PER_RUN},
                    (_, i) => `s-${iter}-${i}`,
                )
                const qc = store.get(queryClientAtom)
                for (const sid of scenarioIds) {
                    qc.setQueryData(["evaluation-results", "p1", runId, sid], [
                        {run_id: runId, scenario_id: sid, step_key: "x", status: "ok"},
                    ] as EvaluationResult[])
                }
                await evaluationResultMolecule.actions.prefetchByScenarioIds({
                    projectId: "p1",
                    runId,
                    scenarioIds,
                })
                // NO eviction — this is the contrast
            }

            forceGc()
            const finalSize = process.memoryUsage().heapUsed
            const growthMB = (finalSize - baselineSize) / 1024 / 1024

            const cache = inspectCache({prefixes: ["evaluation-results"]})

            // Total cache entries = ITERATIONS * SCENARIOS_PER_RUN
            assert.equal(
                cache.totalEntries,
                ITERATIONS * SCENARIOS_PER_RUN,
                "cache accumulates every entry without eviction",
            )

            console.log(
                `\n  WITHOUT eviction: ${cache.totalEntries} cache entries, heap +${growthMB.toFixed(1)} MB`,
            )

            // We don't fail this test — it's documenting current behaviour.
            // The signal: cache.totalEntries grew linearly. The lesson:
            // long-run scripts MUST call evictByRunId.
        },
    )
})
