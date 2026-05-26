/**
 * Unit tests for the per-scenario read-only molecules.
 *
 * Scope: lock in the **cache contract** — what gets read, what gets written,
 * what `invalidate()` does. End-to-end fetch flow is exercised in the PoC
 * against a real backend.
 *
 * We avoid mocking the api module (ESM bindings are read-only). Instead we
 * exercise the cache directly via `queryClient.setQueryData` and verify the
 * molecule reads it correctly. Network behavior is implicit — if the cache
 * is full, no network call is made (we verify via assertion that
 * `prefetchByScenarioIds` resolves synchronously with `fetchMs === 0` and
 * `cacheHits === scenarioIds.length`).
 */

import assert from "node:assert/strict"
import {afterEach, beforeEach, describe, it} from "node:test"

import {QueryClient} from "@tanstack/query-core"
import {getDefaultStore} from "jotai/vanilla"
import {queryClientAtom} from "jotai-tanstack-query"

import type {EvaluationMetric, EvaluationResult} from "../../core"
import {evaluationMetricMolecule} from "../metricMolecule"
import {evaluationResultMolecule} from "../resultMolecule"

const store = getDefaultStore()
const realQueryClient = store.get(queryClientAtom)
let testQc: QueryClient

beforeEach(() => {
    testQc = new QueryClient({
        defaultOptions: {queries: {retry: false, gcTime: Infinity, staleTime: Infinity}},
    })
    store.set(queryClientAtom, testQc)
})

afterEach(() => {
    store.set(queryClientAtom, realQueryClient)
})

function makeResult(scenarioId: string, stepKey: string, extras: Partial<EvaluationResult> = {}) {
    return {
        run_id: "run1",
        scenario_id: scenarioId,
        step_key: stepKey,
        status: "success",
        ...extras,
    } as EvaluationResult
}

function makeMetric(scenarioId: string | null, extras: Partial<EvaluationMetric> = {}) {
    return {
        id: `m-${scenarioId ?? "agg"}`,
        run_id: "run1",
        scenario_id: scenarioId,
        status: "success",
        ...extras,
    } as EvaluationMetric
}

// ============================================================================
// evaluationResultMolecule
// ============================================================================

describe("evaluationResultMolecule", () => {
    const projectId = "p1"
    const runId = "run1"

    it("get.byScenario returns null when cache empty", () => {
        const out = evaluationResultMolecule.get.byScenario({projectId, runId, scenarioId: "s1"})
        assert.equal(out, null)
    })

    it("get.byScenario returns cached array when populated externally", () => {
        const rows = [makeResult("s1", "step-a")]
        testQc.setQueryData(["evaluation-results", projectId, runId, "s1"], rows)
        const out = evaluationResultMolecule.get.byScenario({projectId, runId, scenarioId: "s1"})
        assert.deepEqual(out, rows)
    })

    it("get.byScenario returns empty array when cache has []", () => {
        testQc.setQueryData(["evaluation-results", projectId, runId, "s1"], [])
        const out = evaluationResultMolecule.get.byScenario({projectId, runId, scenarioId: "s1"})
        assert.deepEqual(out, [])
    })

    it("prefetchByScenarioIds: empty input → no work", async () => {
        const out = await evaluationResultMolecule.actions.prefetchByScenarioIds({
            projectId,
            runId,
            scenarioIds: [],
        })
        assert.equal(out.cacheHits, 0)
        assert.equal(out.cacheMisses, 0)
        assert.equal(out.fetchMs, 0)
        assert.equal(out.results.length, 0)
    })

    it("prefetchByScenarioIds: full cache → 100% hits, no fetch", async () => {
        const s1Rows = [makeResult("s1", "step-a"), makeResult("s1", "step-b")]
        const s2Rows = [makeResult("s2", "step-a")]
        testQc.setQueryData(["evaluation-results", projectId, runId, "s1"], s1Rows)
        testQc.setQueryData(["evaluation-results", projectId, runId, "s2"], s2Rows)

        const out = await evaluationResultMolecule.actions.prefetchByScenarioIds({
            projectId,
            runId,
            scenarioIds: ["s1", "s2"],
        })
        assert.equal(out.cacheHits, 2)
        assert.equal(out.cacheMisses, 0)
        assert.equal(out.fetchMs, 0, "no network when fully cached")
        assert.equal(out.results.length, 3)
        assert.deepEqual(out.byScenarioId.get("s1"), s1Rows)
        assert.deepEqual(out.byScenarioId.get("s2"), s2Rows)
    })

    it("prefetchByScenarioIds: scenario with [] in cache counts as hit (not refetched)", async () => {
        testQc.setQueryData(["evaluation-results", projectId, runId, "s1"], [])
        const out = await evaluationResultMolecule.actions.prefetchByScenarioIds({
            projectId,
            runId,
            scenarioIds: ["s1"],
        })
        assert.equal(out.cacheHits, 1)
        assert.equal(out.cacheMisses, 0)
        assert.equal(out.fetchMs, 0)
    })

    it("invalidate() drops a single scenario's cache entry", () => {
        testQc.setQueryData(["evaluation-results", projectId, runId, "s1"], [makeResult("s1", "x")])
        testQc.setQueryData(["evaluation-results", projectId, runId, "s2"], [makeResult("s2", "x")])

        evaluationResultMolecule.actions.invalidate({projectId, runId, scenarioId: "s1"})

        // s1 cleared, s2 untouched
        assert.equal(
            evaluationResultMolecule.get.byScenario({projectId, runId, scenarioId: "s1"}),
            null,
        )
        const s2 = evaluationResultMolecule.get.byScenario({projectId, runId, scenarioId: "s2"})
        assert.ok(Array.isArray(s2))
        assert.equal(s2?.length, 1)
    })

    it("cache key isolates by projectId + runId", () => {
        testQc.setQueryData(["evaluation-results", "p1", "run1", "s1"], [makeResult("s1", "x")])
        const sameProjectDifferentRun = evaluationResultMolecule.get.byScenario({
            projectId: "p1",
            runId: "run2",
            scenarioId: "s1",
        })
        assert.equal(sameProjectDifferentRun, null)

        const differentProjectSameRun = evaluationResultMolecule.get.byScenario({
            projectId: "p2",
            runId: "run1",
            scenarioId: "s1",
        })
        assert.equal(differentProjectSameRun, null)
    })
})

// ============================================================================
// evaluationMetricMolecule
// ============================================================================

describe("evaluationMetricMolecule", () => {
    const projectId = "p1"
    const runId = "run1"

    it("get.byScenario returns null when cache empty", () => {
        const out = evaluationMetricMolecule.get.byScenario({projectId, runId, scenarioId: "s1"})
        assert.equal(out, null)
    })

    it("get.byScenario returns cached metrics", () => {
        const rows = [makeMetric("s1")]
        testQc.setQueryData(["evaluation-metrics", projectId, runId, "s1"], rows)
        const out = evaluationMetricMolecule.get.byScenario({projectId, runId, scenarioId: "s1"})
        assert.deepEqual(out, rows)
    })

    it("prefetchByScenarioIds: full cache → 100% hits, no fetch", async () => {
        testQc.setQueryData(["evaluation-metrics", projectId, runId, "s1"], [makeMetric("s1")])
        testQc.setQueryData(["evaluation-metrics", projectId, runId, "s2"], [makeMetric("s2")])

        const out = await evaluationMetricMolecule.actions.prefetchByScenarioIds({
            projectId,
            runId,
            scenarioIds: ["s1", "s2"],
        })
        assert.equal(out.cacheHits, 2)
        assert.equal(out.cacheMisses, 0)
        assert.equal(out.fetchMs, 0)
        assert.equal(out.metrics.length, 2)
    })

    it("invalidate() drops a metric's cache entry", () => {
        testQc.setQueryData(["evaluation-metrics", projectId, runId, "s1"], [makeMetric("s1")])
        evaluationMetricMolecule.actions.invalidate({projectId, runId, scenarioId: "s1"})
        assert.equal(
            evaluationMetricMolecule.get.byScenario({projectId, runId, scenarioId: "s1"}),
            null,
        )
    })

    it("does not group run-level aggregates (scenario_id=null) under any scenario", async () => {
        // Pre-populate cache for s1, no metric for s2.
        testQc.setQueryData(["evaluation-metrics", projectId, runId, "s1"], [makeMetric("s1")])
        const out = await evaluationMetricMolecule.actions.prefetchByScenarioIds({
            projectId,
            runId,
            scenarioIds: ["s1"],
        })
        // Verify the cached s1 metric came through and is keyed properly.
        assert.equal(out.byScenarioId.get("s1")?.length, 1)
        assert.equal(out.byScenarioId.get(null as unknown as string), undefined)
    })
})

// ============================================================================
// Cache key shape — locking these in so different cache key shapes don't
// silently fragment the cache.
// ============================================================================

describe("cache key shape (locked-in contract)", () => {
    it("result molecule key: ['evaluation-results', projectId, runId, scenarioId]", () => {
        testQc.setQueryData(["evaluation-results", "p", "r", "s"], [makeResult("s", "x")])
        const out = evaluationResultMolecule.get.byScenario({
            projectId: "p",
            runId: "r",
            scenarioId: "s",
        })
        assert.ok(out)
    })

    it("metric molecule key: ['evaluation-metrics', projectId, runId, scenarioId]", () => {
        testQc.setQueryData(["evaluation-metrics", "p", "r", "s"], [makeMetric("s")])
        const out = evaluationMetricMolecule.get.byScenario({
            projectId: "p",
            runId: "r",
            scenarioId: "s",
        })
        assert.ok(out)
    })
})
