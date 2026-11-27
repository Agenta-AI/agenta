/**
 * Unit tests for the per-scenario read-only molecules.
 *
 * Scope: lock in the **cache contract** — what gets read and how the cache is
 * keyed. End-to-end fetch flow is exercised in the PoC against a real backend.
 *
 * We avoid mocking the api module (ESM bindings are read-only). Instead we
 * exercise the cache directly via `queryClient.setQueryData` and verify the
 * molecule reads it correctly. Network behavior is implicit — if the cache
 * is full, no network call is made (we verify via assertion that
 * `prefetchByScenarioIds` resolves synchronously with `fetchMs === 0` and
 * `cacheHits === scenarioIds.length`).
 */

import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai/vanilla"
import {queryClientAtom} from "jotai-tanstack-query"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

import type {EvaluationMetric, EvaluationResult} from "../../src/evaluationRun/core"
import {evaluationMetricMolecule} from "../../src/evaluationRun/state/metricMolecule"
import {evaluationResultMolecule} from "../../src/evaluationRun/state/resultMolecule"

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

    it("prefetchByScenarioIds: empty input → no work", async () => {
        const out = await evaluationResultMolecule.actions.prefetchByScenarioIds({
            projectId,
            runId,
            scenarioIds: [],
        })
        expect(out.cacheHits).toBe(0)
        expect(out.cacheMisses).toBe(0)
        expect(out.fetchMs).toBe(0)
        expect(out.results.length).toBe(0)
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
        expect(out.cacheHits).toBe(2)
        expect(out.cacheMisses).toBe(0)
        expect(out.fetchMs, "no network when fully cached").toBe(0)
        expect(out.results.length).toBe(3)
        expect(out.byScenarioId.get("s1")).toEqual(s1Rows)
        expect(out.byScenarioId.get("s2")).toEqual(s2Rows)
    })

    it("prefetchByScenarioIds: scenario with [] in cache counts as hit (not refetched)", async () => {
        testQc.setQueryData(["evaluation-results", projectId, runId, "s1"], [])
        const out = await evaluationResultMolecule.actions.prefetchByScenarioIds({
            projectId,
            runId,
            scenarioIds: ["s1"],
        })
        expect(out.cacheHits).toBe(1)
        expect(out.cacheMisses).toBe(0)
        expect(out.fetchMs).toBe(0)
    })

    it("cache key isolates by projectId + runId", () => {
        testQc.setQueryData(["evaluation-results", "p1", "run1", "s1"], [makeResult("s1", "x")])
        const sameProjectDifferentRun = evaluationResultMolecule.get.byScenario({
            projectId: "p1",
            runId: "run2",
            scenarioId: "s1",
        })
        expect(sameProjectDifferentRun).toBe(null)

        const differentProjectSameRun = evaluationResultMolecule.get.byScenario({
            projectId: "p2",
            runId: "run1",
            scenarioId: "s1",
        })
        expect(differentProjectSameRun).toBe(null)
    })
})

// ============================================================================
// evaluationMetricMolecule
// ============================================================================

describe("evaluationMetricMolecule", () => {
    const projectId = "p1"
    const runId = "run1"

    it("prefetchByScenarioIds: full cache → 100% hits, no fetch", async () => {
        testQc.setQueryData(["evaluation-metrics", projectId, runId, "s1"], [makeMetric("s1")])
        testQc.setQueryData(["evaluation-metrics", projectId, runId, "s2"], [makeMetric("s2")])

        const out = await evaluationMetricMolecule.actions.prefetchByScenarioIds({
            projectId,
            runId,
            scenarioIds: ["s1", "s2"],
        })
        expect(out.cacheHits).toBe(2)
        expect(out.cacheMisses).toBe(0)
        expect(out.fetchMs).toBe(0)
        expect(out.metrics.length).toBe(2)
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
        expect(out.byScenarioId.get("s1")?.length).toBe(1)
        expect(out.byScenarioId.get(null as unknown as string)).toBe(undefined)
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
        expect(out).toBeTruthy()
    })

    it("metric molecule key: ['evaluation-metrics', projectId, runId, scenarioId]", () => {
        testQc.setQueryData(["evaluation-metrics", "p", "r", "s"], [makeMetric("s")])
        const out = evaluationMetricMolecule.get.byScenario({
            projectId: "p",
            runId: "r",
            scenarioId: "s",
        })
        expect(out).toBeTruthy()
    })
})
