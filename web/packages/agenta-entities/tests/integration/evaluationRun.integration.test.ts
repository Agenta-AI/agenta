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
import {getAgentaSdkClient} from "@agenta/sdk"
import {describe, it, expect, beforeAll, afterAll} from "vitest"

import {
    deleteEvaluationQueue,
    fetchEvaluationQueue,
    queryEvaluationQueues,
} from "../../src/evaluationQueue/api"
import {evaluationQueueMolecule} from "../../src/evaluationQueue"
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

// Step keys / mapping shape mirroring what the real UI's buildRunConfig emits. The
// column.kind values ("testset"/"invocation"/"evaluator") are exactly what an over-strict
// schema rejected on read-back, silently dropping the run and blanking the table.
const INPUT_KEY = "testset-entities-it"
const INVOCATION_KEY = "invocation-entities-it"
const EVALUATOR_STEP_KEY = `${INVOCATION_KEY}.evaluator`

function makeRunCreatePayload() {
    return {
        name: `entities-it-${Date.now()}`,
        meta: {source: "entities-integration", evaluation_kind: "human"},
        data: {
            steps: [
                {key: INPUT_KEY, type: "input", origin: "auto", references: {}},
                {
                    key: INVOCATION_KEY,
                    type: "invocation",
                    origin: "human",
                    references: {},
                    inputs: [{key: INPUT_KEY}],
                },
                {
                    key: EVALUATOR_STEP_KEY,
                    type: "annotation",
                    origin: "human",
                    references: {
                        evaluator: {id: "00000000-0000-4000-8000-0000000000e1"},
                        evaluator_revision: {id: "00000000-0000-4000-8000-0000000000e2"},
                    },
                    inputs: [{key: INPUT_KEY}, {key: INVOCATION_KEY}],
                },
            ],
            mappings: [
                {
                    column: {kind: "testset", name: "country"},
                    step: {key: INPUT_KEY, path: "data.country"},
                },
                {
                    column: {kind: "invocation", name: "outputs"},
                    step: {key: INVOCATION_KEY, path: "attributes.ag.data.outputs"},
                },
                {
                    column: {kind: "evaluator", name: "evaluator.success"},
                    step: {key: EVALUATOR_STEP_KEY, path: "attributes.ag.data.outputs.success"},
                },
            ],
        },
    }
}

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

    // The block the original suite was missing: a POPULATED run. Creating one (raw Fern
    // client — entities cannot depend on @agenta/evaluations) and reading it back through
    // the api + molecule is the path that silently returned nothing when the mapping-kind
    // enum rejected real values. Empty-project assertions above can never catch that.
    describe("populated run (molecule selectors against real backend data)", () => {
        let runId = ""

        beforeAll(async () => {
            const client = getAgentaSdkClient()
            const res = (await client.evaluations.createRuns(
                {runs: [makeRunCreatePayload() as never]},
                {queryParams: {project_id: projectId}},
            )) as {runs?: {id?: string}[]}
            runId = res?.runs?.[0]?.id ?? ""
            expect(runId, "run creation must return an id").toBeTruthy()
        })

        afterAll(async () => {
            if (!runId) return
            await getAgentaSdkClient()
                .evaluations.deleteRuns({run_ids: [runId]}, {queryParams: {project_id: projectId}})
                .catch(() => undefined)
        })

        it("queryEvaluationRuns returns the run with mapping kinds preserved", async () => {
            const res = await queryEvaluationRuns({projectId, ids: [runId]})
            const run = res.runs.find((r) => r.id === runId)
            expect(run, "the created run must survive the Zod parse").toBeTruthy()
            const kinds = (run?.data?.mappings ?? []).map((m) => m.column?.kind).filter(Boolean)
            expect(kinds).toContain("testset")
            expect(kinds).toContain("invocation")
            expect(kinds).toContain("evaluator")
        })

        it("fetchEvaluationRun returns the populated run", async () => {
            const run = await fetchEvaluationRun({id: runId, projectId})
            expect(run?.id).toBe(runId)
            expect((run?.meta as Record<string, unknown>)?.evaluation_kind).toBe("human")
        })

        it("molecule selectors derive steps / annotation steps / mappings from real data", async () => {
            const {store} = createIntegrationStore()

            // Drive the query atom until the run resolves, then read the derived selectors
            // from the SAME store (they all hang off evaluationRunQueryAtomFamily).
            await waitForAtom<{isPending: boolean; data: unknown}>(
                store,
                evaluationRunMolecule.atoms.query({projectId, runId}),
                (q) => !q.isPending && !!q.data,
            )

            const data = store.get(evaluationRunMolecule.selectors.data({projectId, runId}))
            expect(data?.id).toBe(runId)

            const steps = store.get(evaluationRunMolecule.selectors.steps({projectId, runId}))
            expect(steps).toHaveLength(3)

            const annotationSteps = store.get(
                evaluationRunMolecule.selectors.annotationSteps({projectId, runId}),
            )
            expect(annotationSteps).toHaveLength(1)
            expect(annotationSteps[0]?.key).toBe(EVALUATOR_STEP_KEY)

            const mappings = store.get(evaluationRunMolecule.selectors.mappings({projectId, runId}))
            const mappingKinds = mappings.map((m) => m.column?.kind).filter(Boolean)
            expect(mappingKinds).toEqual(
                expect.arrayContaining(["testset", "invocation", "evaluator"]),
            )

            // Evaluator ids derive from annotation-step references (annotation creation path).
            const evaluatorIds = store.get(
                evaluationRunMolecule.selectors.evaluatorIds({projectId, runId}),
            )
            expect(evaluatorIds).toContain("00000000-0000-4000-8000-0000000000e1")
        })
    })

    // evaluationQueue molecule — full-CRUD entity, previously only exercised via an
    // empty-envelope read. A queue hangs off a run (run_id required), so create both,
    // then verify the api parses the populated queue and the molecule's entity atoms
    // resolve its fields against the real backend.
    describe("evaluationQueue molecule (CRUD round-trip against real backend)", () => {
        let queueRunId = ""
        let queueId = ""

        beforeAll(async () => {
            const client = getAgentaSdkClient()
            const runRes = (await client.evaluations.createRuns(
                {runs: [makeRunCreatePayload() as never]},
                {queryParams: {project_id: projectId}},
            )) as {runs?: {id?: string}[]}
            queueRunId = runRes?.runs?.[0]?.id ?? ""
            expect(queueRunId).toBeTruthy()

            const queueRes = (await client.evaluations.createQueues(
                {queues: [{run_id: queueRunId, name: `entities-queue-it-${Date.now()}`} as never]},
                {queryParams: {project_id: projectId}},
            )) as {queues?: {id?: string}[]}
            queueId = queueRes?.queues?.[0]?.id ?? ""
            expect(queueId, "queue creation must return an id").toBeTruthy()
        })

        afterAll(async () => {
            if (queueId) {
                await deleteEvaluationQueue({id: queueId, projectId}).catch(() => undefined)
            }
            if (queueRunId) {
                await getAgentaSdkClient()
                    .evaluations.deleteRuns(
                        {run_ids: [queueRunId]},
                        {queryParams: {project_id: projectId}},
                    )
                    .catch(() => undefined)
            }
        })

        it("queryEvaluationQueues + fetchEvaluationQueue parse the populated queue", async () => {
            const list = await queryEvaluationQueues({projectId})
            expect(list.queues.some((q) => q.id === queueId)).toBe(true)

            const queue = await fetchEvaluationQueue({id: queueId, projectId})
            expect(queue?.id).toBe(queueId)
            expect(queue?.run_id).toBe(queueRunId)
        })

        it("molecule entity atoms resolve the queue's name + run id", async () => {
            const {store} = createIntegrationStore()

            await waitForAtom<{isPending: boolean; data: unknown}>(
                store,
                evaluationQueueMolecule.atoms.query(queueId),
                (q) => !q.isPending && !!q.data,
            )

            expect(store.get(evaluationQueueMolecule.selectors.runId(queueId))).toBe(queueRunId)
            expect(store.get(evaluationQueueMolecule.selectors.data(queueId))?.id).toBe(queueId)
        })
    })
})
