/**
 * Integration tests for the evaluationRun data layer (atoms + api) against a real backend.
 *
 * Skipped automatically unless AGENTA_API_URL + AGENTA_AUTH_KEY are set (globalSetup
 * mints an ephemeral account + API key; setup/worker.ts authenticates BOTH axios and the
 * Fern client — the eval api goes through the Fern @agentaai/api-client).
 *
 *   AGENTA_API_URL=http://localhost/api \
 *   AGENTA_AUTH_KEY=<admin key> \
 *   pnpm --filter @agenta/entities run test:integration
 *
 * These run against a FRESH ephemeral project (no fixtures), so every query returns
 * empty. That is exactly the contract worth pinning: the Fern client constructs +
 * authenticates, the /evaluations/{runs,results,metrics,queues} endpoints are reachable,
 * the Zod boundary validates real responses (passthrough preserves extra fields, known
 * fields parse), and the decoupled {projectId, runId} atom wiring fetches correctly —
 * all without throwing. Catches auth/endpoint/schema drift a unit test with fixtures can't.
 */
import {describe, it, expect} from "vitest"

import {queryEvaluationQueues} from "../../src/evaluationQueue/api"
import {evaluationRunMolecule} from "../../src/evaluationRun"
import {
    fetchEvaluationRun,
    queryEvaluationMetrics,
    queryEvaluationResults,
    queryEvaluationRuns,
} from "../../src/evaluationRun/api"

import {TEST_CONFIG, hasBackend} from "./helpers/env"
import {createIntegrationStore, waitForAtom} from "./helpers/store"

// A well-formed UUID that will not exist in a fresh ephemeral project.
const ABSENT_ID = "00000000-0000-0000-0000-000000000000"

describe.skipIf(!hasBackend)("evaluationRun data layer integration", () => {
    const projectId = TEST_CONFIG.projectId

    describe("api functions (atom data source, Fern + Zod against real backend)", () => {
        it("queryEvaluationRuns returns an empty, well-formed envelope for absent ids", async () => {
            const res = await queryEvaluationRuns({projectId, ids: [ABSENT_ID]})
            expect(typeof res.count).toBe("number")
            expect(Array.isArray(res.runs)).toBe(true)
            expect(res.runs).toHaveLength(0)
        })

        it("fetchEvaluationRun returns null for an absent run", async () => {
            const run = await fetchEvaluationRun({id: ABSENT_ID, projectId})
            expect(run).toBeNull()
        })

        it("queryEvaluationResults returns [] for an absent run/scenario", async () => {
            const results = await queryEvaluationResults({
                projectId,
                runId: ABSENT_ID,
                scenarioIds: [ABSENT_ID],
            })
            expect(Array.isArray(results)).toBe(true)
            expect(results).toHaveLength(0)
        })

        it("queryEvaluationMetrics returns [] for an absent run", async () => {
            const metrics = await queryEvaluationMetrics({projectId, runId: ABSENT_ID})
            expect(Array.isArray(metrics)).toBe(true)
            expect(metrics).toHaveLength(0)
        })

        it("queryEvaluationQueues returns a well-formed envelope for the fresh project", async () => {
            const res = await queryEvaluationQueues({projectId})
            expect(typeof res.count).toBe("number")
            expect(Array.isArray(res.queues)).toBe(true)
        })
    })

    describe("evaluationRunMolecule atom (decoupled {projectId, runId} key)", () => {
        it("fetches via the query atom and resolves an absent run to null data", async () => {
            const {store} = createIntegrationStore()

            const query = await waitForAtom<{isPending: boolean; data: unknown}>(
                store,
                evaluationRunMolecule.atoms.query({projectId, runId: ABSENT_ID}),
                (q) => !q.isPending,
            )
            expect(query.data ?? null).toBeNull()

            // The derived selector reflects the same null (no run exists).
            const data = store.get(
                evaluationRunMolecule.selectors.data({projectId, runId: ABSENT_ID}),
            )
            expect(data).toBeNull()
        })
    })
})
