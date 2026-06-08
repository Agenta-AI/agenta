/**
 * Integration tests for the evaluationScenario entity (api + molecule) against a real
 * backend. Promoted out of evaluationRun in WP-0.
 *
 * Drives the SHIPPED surface — `queryEvaluationScenarios`/`setEvaluationScenarioStatuses`
 * and `evaluationScenarioMolecule` selectors — not a replica. Setup seeds a run + scenario
 * via the raw Fern client (entities can't depend on @agenta/evaluations); all assertions go
 * through the shipped package surface.
 *
 *   AGENTA_API_URL=http://localhost/api AGENTA_AUTH_KEY=<admin key> \
 *   pnpm --filter @agenta/entities run test:integration
 */
import {getAgentaSdkClient} from "@agenta/sdk"
import {describe, it, expect, beforeAll, afterAll} from "vitest"

import {
    queryEvaluationScenarios,
    setEvaluationScenarioStatuses,
    evaluationScenarioMolecule,
} from "../../src/evaluationScenario"

import {TEST_CONFIG, hasBackend} from "./helpers/env"
import {createIntegrationStore, waitForAtom} from "./helpers/store"

describe.skipIf(!hasBackend)("evaluationScenario entity integration", () => {
    const projectId = TEST_CONFIG.projectId
    let runId = ""
    let scenarioId = ""

    beforeAll(async () => {
        const client = getAgentaSdkClient()
        const runRes = (await client.evaluations.createRuns(
            {
                runs: [
                    {
                        name: `scenario-it-${Date.now()}`,
                        meta: {source: "scenario-integration"},
                        data: {steps: [], mappings: []},
                    } as never,
                ],
            },
            {queryParams: {project_id: projectId}},
        )) as {runs?: {id?: string}[]}
        runId = runRes?.runs?.[0]?.id ?? ""
        expect(runId, "run creation must return an id").toBeTruthy()

        const scenarioRes = (await client.evaluations.createScenarios(
            {scenarios: [{run_id: runId} as never]},
            {queryParams: {project_id: projectId}},
        )) as {scenarios?: {id?: string}[]}
        scenarioId = scenarioRes?.scenarios?.[0]?.id ?? ""
        expect(scenarioId, "scenario creation must return an id").toBeTruthy()
    })

    afterAll(async () => {
        if (!runId) return
        await getAgentaSdkClient()
            .evaluations.deleteRuns({run_ids: [runId]}, {queryParams: {project_id: projectId}})
            .catch(() => undefined)
    })

    describe("api", () => {
        it("queryEvaluationScenarios returns the run's scenarios (parsed)", async () => {
            const scenarios = await queryEvaluationScenarios({projectId, runId})
            expect(scenarios.some((s) => s.id === scenarioId)).toBe(true)
        })

        it("setEvaluationScenarioStatuses persists a status change", async () => {
            await setEvaluationScenarioStatuses({
                projectId,
                scenarios: [{id: scenarioId, status: "success"}],
            })

            const after = await queryEvaluationScenarios({projectId, runId})
            expect(after.find((s) => s.id === scenarioId)?.status).toBe("success")
        })
    })

    describe("molecule (decoupled {projectId, runId} key)", () => {
        it("query atom + selectors resolve the run's scenarios", async () => {
            const {store} = createIntegrationStore()

            await waitForAtom<{isPending: boolean; data: unknown[]}>(
                store,
                evaluationScenarioMolecule.atoms.query({projectId, runId}),
                (q) => !q.isPending && Array.isArray(q.data) && q.data.length > 0,
            )

            const list = store.get(evaluationScenarioMolecule.selectors.list({projectId, runId}))
            expect(list.some((s) => s.id === scenarioId)).toBe(true)

            const ids = store.get(evaluationScenarioMolecule.selectors.ids({projectId, runId}))
            expect(ids).toContain(scenarioId)

            const statuses = store.get(
                evaluationScenarioMolecule.selectors.statuses({projectId, runId}),
            )
            expect(Object.prototype.hasOwnProperty.call(statuses, scenarioId)).toBe(true)
        })
    })
})
