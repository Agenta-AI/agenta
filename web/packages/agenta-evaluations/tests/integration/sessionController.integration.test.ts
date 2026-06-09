/**
 * Integration test for the generic evaluation session engine against a real backend.
 *
 * Drives the SHIPPED `evaluationSessionController` atoms (navigation/progress/status) over a
 * REAL run's scenarios. The scenario source is INJECTED (as a real consumer would) — fetched
 * via the real `queryEvaluationScenarios`, then fed in with `actions.setScenarios`. No replica
 * of the navigation logic; if the engine is deleted this fails to compile.
 *
 *   AGENTA_API_URL=http://localhost/api AGENTA_AUTH_KEY=<admin key> \
 *   pnpm --filter @agenta/evaluations run test:integration
 */
import {queryEvaluationScenarios} from "@agenta/entities/evaluationScenario"
import {getAgentaSdkClient} from "@agenta/sdk"
import {createStore} from "jotai"
import {describe, it, expect, beforeAll, afterAll} from "vitest"

import {evaluationSessionController as c} from "../../src/state/session"

import {TEST_CONFIG, hasBackend} from "./helpers/env"

describe.skipIf(!hasBackend)("evaluationSessionController integration", () => {
    const projectId = TEST_CONFIG.projectId
    let runId = ""
    let scenarioIds: string[] = []

    beforeAll(async () => {
        const client = getAgentaSdkClient()
        const runRes = (await client.evaluations.createRuns(
            {
                runs: [
                    {
                        name: `session-it-${Date.now()}`,
                        meta: {source: "session-integration"},
                        data: {steps: [], mappings: []},
                    } as never,
                ],
            },
            {queryParams: {project_id: projectId}},
        )) as {runs?: {id?: string}[]}
        runId = runRes?.runs?.[0]?.id ?? ""
        expect(runId).toBeTruthy()

        // Create 3 scenarios so navigation has something to walk.
        const scenRes = (await client.evaluations.createScenarios(
            {scenarios: [{run_id: runId}, {run_id: runId}, {run_id: runId}] as never},
            {queryParams: {project_id: projectId}},
        )) as {scenarios?: {id?: string}[]}
        scenarioIds = (scenRes?.scenarios ?? []).map((s) => s.id).filter(Boolean) as string[]
        expect(scenarioIds.length).toBe(3)
    })

    afterAll(async () => {
        if (!runId) return
        await getAgentaSdkClient()
            .evaluations.deleteRuns({run_ids: [runId]}, {queryParams: {project_id: projectId}})
            .catch(() => undefined)
    })

    it("navigates a real run's scenarios via the shipped engine atoms", async () => {
        const store = createStore()

        // Real scenario source, injected (the consumer's job).
        const scenarios = await queryEvaluationScenarios({projectId, runId})
        expect(scenarios.length).toBe(3)

        store.set(c.actions.openSession, {projectId, runId})
        store.set(c.actions.setScenarios, {scenarios})

        // Engine sees all scenarios; current = first; can advance.
        const ids = store.get(c.selectors.scenarioIds())
        expect(new Set(ids)).toEqual(new Set(scenarioIds))
        expect(store.get(c.selectors.activeRunId())).toBe(runId)
        expect(store.get(c.selectors.progress()).total).toBe(3)

        const first = store.get(c.selectors.currentScenarioId())
        expect(first).toBeTruthy()
        expect(store.get(c.selectors.hasPrev())).toBe(false)
        expect(store.get(c.selectors.hasNext())).toBe(true)

        store.set(c.actions.navigateNext)
        const second = store.get(c.selectors.currentScenarioId())
        expect(second).not.toBe(first)
        expect(store.get(c.selectors.currentScenarioIndex())).toBe(1)
        expect(store.get(c.selectors.hasPrev())).toBe(true)

        store.set(c.actions.navigatePrev)
        expect(store.get(c.selectors.currentScenarioId())).toBe(first)
    })

    it("markCompleted updates progress + status via the engine", async () => {
        const store = createStore()
        const scenarios = await queryEvaluationScenarios({projectId, runId})

        store.set(c.actions.openSession, {projectId, runId})
        store.set(c.actions.setScenarios, {scenarios})

        const target = store.get(c.selectors.currentScenarioId())!
        expect(store.get(c.selectors.progress()).completed).toBe(0)

        store.set(c.actions.markCompleted, target)
        expect(store.get(c.selectors.scenarioStatuses())[target]).toBe("success")
        expect(store.get(c.selectors.progress()).completed).toBe(1)
    })

    it("hideCompletedInFocus removes completed scenarios from navigation", async () => {
        const store = createStore()
        const scenarios = await queryEvaluationScenarios({projectId, runId})

        store.set(c.actions.openSession, {projectId, runId})
        store.set(c.actions.setScenarios, {scenarios})

        const first = store.get(c.selectors.currentScenarioId())!
        store.set(c.actions.markCompleted, first)
        store.set(c.actions.setHideCompletedInFocus, true)

        const navigable = store.get(c.selectors.navigableScenarioIds())
        expect(navigable).not.toContain(first)
        expect(navigable.length).toBe(2)
    })
})
