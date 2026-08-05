/**
 * Integration tests for the Evaluations service.
 * Covers simple evaluations, runs, scenarios, results, and metrics.
 */

import {describe, it, expect, beforeAll} from "vitest"

import type {Agenta} from "@src/index.js"

import {canRun, createTestClient} from "./setup.js"

describe.skipIf(!canRun)("sdk: evaluations", () => {
    let ag: Agenta

    beforeAll(async () => {
        ag = await createTestClient()
    })

    // ── Simple Evaluations ───────────────────────────────────────────────────

    describe("simple evaluations", () => {
        it("queries simple evaluations", async () => {
            const result = await ag.evaluations.querySimple({
                windowing: {limit: 5},
            })

            expect(result.count).toBeGreaterThanOrEqual(0)
            expect(Array.isArray(result.evaluations)).toBe(true)
        })

        it("creates a simple evaluation", async () => {
            const result = await ag.evaluations.createSimple({
                name: `sdk-eval-test-${Date.now()}`,
                data: {
                    application_steps: {},
                    testset_steps: {},
                    evaluator_steps: {},
                },
            })

            expect(result.evaluation).toBeDefined()
            expect(result.evaluation!.id).toBeTruthy()
        })

        it("gets a simple evaluation by ID", async () => {
            const created = await ag.evaluations.createSimple({
                name: `sdk-eval-get-${Date.now()}`,
                data: {
                    application_steps: {},
                    testset_steps: {},
                    evaluator_steps: {},
                },
            })
            const id = created.evaluation!.id!

            const result = await ag.evaluations.getSimple(id)

            expect(result.evaluation).toBeDefined()
            expect(result.evaluation!.id).toBe(id)
        })

        it("closes and reopens a simple evaluation", async () => {
            const created = await ag.evaluations.createSimple({
                name: `sdk-eval-close-${Date.now()}`,
                data: {
                    application_steps: {},
                    testset_steps: {},
                    evaluator_steps: {},
                },
            })
            const id = created.evaluation!.id!

            const closed = await ag.evaluations.closeSimple(id)
            expect(closed.evaluation).toBeDefined()

            const opened = await ag.evaluations.openSimple(id)
            expect(opened.evaluation).toBeDefined()
        })
    })

    // ── Runs ─────────────────────────────────────────────────────────────────

    describe("runs", () => {
        it("queries runs", async () => {
            const result = await ag.evaluations.queryRuns({
                windowing: {limit: 5},
            })

            expect(result.count).toBeGreaterThanOrEqual(0)
            expect(Array.isArray(result.runs)).toBe(true)
        })

        it("creates and retrieves a run", async () => {
            const created = await ag.evaluations.createRuns([
                {
                    name: `sdk-run-test-${Date.now()}`,
                },
            ])

            expect(created.count).toBeGreaterThanOrEqual(1)
            expect(created.runs.length).toBeGreaterThanOrEqual(1)

            const runId = created.runs[0].id!
            const fetched = await ag.evaluations.getRun(runId)

            expect(fetched).not.toBeNull()
            expect(fetched!.id).toBe(runId)
        })

        it("closes and opens runs", async () => {
            const created = await ag.evaluations.createRuns([
                {name: `sdk-run-close-${Date.now()}`},
            ])
            const runId = created.runs[0].id!

            const closed = await ag.evaluations.closeRuns([runId])
            expect(closed.runs.length).toBeGreaterThanOrEqual(1)

            const opened = await ag.evaluations.openRuns([runId])
            expect(opened.runs.length).toBeGreaterThanOrEqual(1)
        })
    })

    // ── Scenarios ────────────────────────────────────────────────────────────

    describe("scenarios", () => {
        it("queries scenarios", async () => {
            const result = await ag.evaluations.queryScenarios({
                windowing: {limit: 5},
            })

            expect(result.count).toBeGreaterThanOrEqual(0)
            expect(Array.isArray(result.scenarios)).toBe(true)
        })

        it("creates scenarios for a run", async () => {
            const runRes = await ag.evaluations.createRuns([
                {name: `sdk-scen-run-${Date.now()}`},
            ])
            const runId = runRes.runs[0].id!

            const result = await ag.evaluations.createScenarios([
                {
                    run_id: runId,
                    data: {
                        inputs: {question: "What is 2+2?"},
                        expected: {answer: "4"},
                    },
                },
                {
                    run_id: runId,
                    data: {
                        inputs: {question: "Capital of France?"},
                        expected: {answer: "Paris"},
                    },
                },
            ])

            expect(result.count).toBeGreaterThanOrEqual(2)
            expect(result.scenarios.length).toBeGreaterThanOrEqual(2)
        })
    })

    // ── Results & Metrics ────────────────────────────────────────────────────

    describe("results and metrics", () => {
        it("posts results and queries them back", async () => {
            // Create run + scenario
            const runRes = await ag.evaluations.createRuns([
                {name: `sdk-result-run-${Date.now()}`},
            ])
            const runId = runRes.runs[0].id!

            const scenRes = await ag.evaluations.createScenarios([
                {
                    run_id: runId,
                    data: {inputs: {q: "test"}, expected: {a: "answer"}},
                },
            ])
            const scenarioId = scenRes.scenarios[0].id!

            // Post results
            const posted = await ag.evaluations.postResults([
                {
                    run_id: runId,
                    scenario_id: scenarioId,
                    step_key: "exact_match",
                    meta: {score: 1.0, reasoning: "Perfect match"},
                },
            ])

            expect(posted.count).toBeGreaterThanOrEqual(1)

            // Query results back
            const results = await ag.evaluations.queryResults({
                result: {run_ids: [runId]},
            })

            expect(results.count).toBeGreaterThanOrEqual(1)
            expect(results.results.length).toBeGreaterThanOrEqual(1)
        })

        it("getResultsByRun aggregates scores", async () => {
            // Create run + scenario + results
            const runRes = await ag.evaluations.createRuns([
                {name: `sdk-agg-run-${Date.now()}`},
            ])
            const runId = runRes.runs[0].id!

            const scenRes = await ag.evaluations.createScenarios([
                {run_id: runId, data: {inputs: {q: "a"}}},
                {run_id: runId, data: {inputs: {q: "b"}}},
            ])

            await ag.evaluations.postResults([
                {
                    run_id: runId,
                    scenario_id: scenRes.scenarios[0].id!,
                    step_key: "quality",
                    meta: {score: 0.8},
                },
                {
                    run_id: runId,
                    scenario_id: scenRes.scenarios[1].id!,
                    step_key: "quality",
                    meta: {score: 0.6},
                },
            ])

            const byStep = await ag.evaluations.getResultsByRun(runId)

            expect(byStep.quality).toBeDefined()
            expect(byStep.quality.count).toBe(2)
            expect(byStep.quality.avgScore).toBeCloseTo(0.7, 1)
        })

        it("queries metrics", async () => {
            const result = await ag.evaluations.queryMetrics({
                windowing: {limit: 5},
            })

            expect(result.count).toBeGreaterThanOrEqual(0)
        })
    })
})
