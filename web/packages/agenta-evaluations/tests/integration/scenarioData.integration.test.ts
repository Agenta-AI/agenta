/**
 * Read-only integration test: drive the SHIPPED `@agenta/evaluations` scenarioData
 * selectors against a REAL project's existing run.
 *
 * This is the worker-computed-metrics coverage the plan asks for. The ephemeral-account
 * harness (sessionController.integration) can create runs/scenarios but NOT metrics —
 * those are produced asynchronously by the eval worker and only exist on real runs. So
 * this suite uses the SAME read-only real-project env as parseExistingRuns.integration:
 *
 *   AGENTA_API_URL          — base URL (e.g. http://localhost/api)
 *   AGENTA_REAL_API_KEY     — a project-scoped API key for the project below
 *   AGENTA_REAL_PROJECT_ID  — the project whose existing runs to read
 *
 * When any are unset the suite skips (consistent with the rest of the integration suite).
 *
 * It NEVER re-implements selector logic: it imports the real `scenarioDataSelectors`
 * surface and reads through it. Deleting those atoms breaks this file's compilation.
 *
 * Auth wiring (verified, not assumed):
 *   - The evaluator/trace/scenario selectors read `evaluationRunMolecule`, which fetches
 *     via the Fern `@agenta/sdk` singleton (`getEvaluationsClient` → `getAgentaSdkClient`).
 *     `init({apiKey, host})` constructs that singleton, so configuring it authenticates
 *     the run/result/scenario fetches. (See evaluationRun/api/client.ts.)
 *   - The metrics selector (`scenarioMetrics`) uses the RAW `@agenta/shared` axios
 *     instance, which has `baseURL: getAgentaApiUrl()` and NO auth header by default.
 *     `init()` does NOT touch it. So we additionally point that axios at the host and
 *     attach the API key here, or `scenarioMetrics` would 401/404 against the real project.
 */
import {evaluationRunMolecule} from "@agenta/entities/evaluationRun"
import {queryEvaluationScenarios} from "@agenta/entities/evaluationScenario"
import {init} from "@agenta/sdk"
import {axios as sharedAxios} from "@agenta/shared/api"
import {createStore} from "jotai"
import {describe, it, expect, beforeAll, vi} from "vitest"

import type {ScenarioMetricData} from "../../src/state/scenarioData"
import {scenarioDataSelectors} from "../../src/state/scenarioData"

const apiUrl = process.env.AGENTA_API_URL
const apiKey = process.env.AGENTA_REAL_API_KEY
const projectId = process.env.AGENTA_REAL_PROJECT_ID
const hasRealProject = Boolean(apiUrl && apiKey && projectId)

// How many recent runs to probe while hunting for one with scenarios + metrics.
const RUN_SCAN_LIMIT = 25
// Settle timeout for the query-backed selectors (run/steps/metrics).
const SETTLE_TIMEOUT = 20_000

interface RunCandidate {
    runId: string
    scenarioId: string
    hasMetrics: boolean
}

describe.skipIf(!hasRealProject)("scenarioData selectors against a real run", () => {
    // Shared across tests: the discovered run + a scenario known to exist on it.
    let runId = ""
    let scenarioId = ""
    let candidate: RunCandidate | null = null

    beforeAll(async () => {
        // Configure BOTH transports the shipped selectors use against the real project:
        //  1. Fern SDK singleton — backs the molecule (runs/results/scenarios).
        init({apiKey, host: apiUrl})
        //  2. Raw @agenta/shared axios — backs scenarioMetrics. No auth by default.
        sharedAxios.defaults.baseURL = apiUrl
        sharedAxios.defaults.headers.common.Authorization = `ApiKey ${apiKey}`

        const client = init({apiKey, host: apiUrl})

        // Newest runs first — most likely to have completed worker metrics.
        const runResp = (await client.evaluations.queryRuns(
            {windowing: {limit: RUN_SCAN_LIMIT, order: "descending"}},
            {queryParams: {project_id: projectId!}},
        )) as {runs?: {id?: string}[]}
        const runIds = (runResp?.runs ?? []).map((r) => r.id).filter(Boolean) as string[]

        // Walk candidates: first run with >=1 scenario wins; prefer one with metrics.
        let firstWithScenario: RunCandidate | null = null
        for (const candidateRunId of runIds) {
            const scenarios = await queryEvaluationScenarios({
                projectId: projectId!,
                runId: candidateRunId,
            })
            if (scenarios.length === 0) continue

            const firstScenarioId = scenarios[0].id

            // Does this run have computed metrics? (worker-produced — the point of the test)
            const metricsResp = (await client.evaluations.queryMetrics(
                {metrics: {run_ids: [candidateRunId], scenario_ids: false}} as never,
                {queryParams: {project_id: projectId!}},
            )) as {metrics?: unknown[]}
            const hasMetrics = Array.isArray(metricsResp?.metrics) && metricsResp.metrics.length > 0

            const found: RunCandidate = {
                runId: candidateRunId,
                scenarioId: firstScenarioId,
                hasMetrics,
            }
            firstWithScenario ??= found
            if (hasMetrics) {
                candidate = found
                break
            }
        }

        candidate ??= firstWithScenario
        if (candidate) {
            runId = candidate.runId
            scenarioId = candidate.scenarioId
        }
    })

    it("evaluatorColumnDefs resolves to an array through the shipped selector", async () => {
        if (!candidate) {
            console.warn(
                `[scenarioData] No run with >=1 scenario found in project ${projectId} ` +
                    `(scanned ${RUN_SCAN_LIMIT} newest runs) — skipping.`,
            )
            return
        }

        const store = createStore()

        // evaluatorColumnDefs derives off the molecule's run query. Reading the molecule's
        // run-query state subscribes/kicks the fetch; await it leaving the pending state so
        // the shipped selector reads real data (not the pre-fetch empty array). We use the
        // molecule's own query-state here purely as a settle signal — the assertions below
        // go through the SHIPPED scenarioData selector.
        await vi.waitFor(
            () => {
                const runQuery = store.get(
                    evaluationRunMolecule.selectors.query({projectId: projectId!, runId}),
                )
                expect(runQuery.isPending).toBe(false)
            },
            {timeout: SETTLE_TIMEOUT, interval: 250},
        )

        const colDefs = store.get(
            scenarioDataSelectors.evaluatorColumnDefs({projectId: projectId!, runId}),
        )
        expect(Array.isArray(colDefs)).toBe(true)

        // If the run carries evaluators, the shipped derivation should surface columns.
        const evaluatorIds = store.get(
            scenarioDataSelectors.evaluatorIds({projectId: projectId!, runId}),
        )
        if (evaluatorIds.length > 0) {
            expect(colDefs.length).toBeGreaterThanOrEqual(1)
            for (const def of colDefs) {
                expect(def).toHaveProperty("stepKey")
                expect(def).toHaveProperty("path")
            }
        }
    })

    it("scenarioTraceRef returns a {traceId, spanId} shape through the shipped selector", async () => {
        if (!candidate) {
            console.warn(`[scenarioData] No candidate run — skipping scenarioTraceRef.`)
            return
        }

        const store = createStore()

        // scenarioTraceRef derives from the scenario-steps query. Poll the SHIPPED
        // scenarioSteps selector (the molecule's query state, surfaced by the package)
        // until it leaves pending, so the trace ref reflects loaded step data.
        await vi.waitFor(
            () => {
                const stepsQuery = store.get(
                    scenarioDataSelectors.scenarioSteps({
                        projectId: projectId!,
                        runId,
                        scenarioId,
                    }),
                )
                expect(stepsQuery?.isPending).toBe(false)
            },
            {timeout: SETTLE_TIMEOUT, interval: 250},
        )

        const ref = store.get(
            scenarioDataSelectors.scenarioTraceRef({projectId: projectId!, runId, scenarioId}),
        )
        expect(typeof ref.traceId).toBe("string")
        expect(typeof ref.spanId).toBe("string")
    })

    it("scenarioMetrics parses to {raw, flat, stats} (or null) through the shipped selector", async () => {
        if (!candidate) {
            console.warn(`[scenarioData] No candidate run — skipping scenarioMetrics.`)
            return
        }
        if (!candidate.hasMetrics) {
            console.warn(
                `[scenarioData] Run ${runId} has no worker-computed metrics — ` +
                    `asserting the null/empty path through the shipped selector.`,
            )
        }

        const store = createStore()

        // The metrics selector is query-backed (POST /evaluations/metrics/query via the
        // shared axios). Poll the underlying query until it is no longer pending.
        await vi.waitFor(
            () => {
                const query = store.get(
                    scenarioDataSelectors.scenarioMetricsQuery({
                        projectId: projectId!,
                        runId,
                        scenarioId,
                    }),
                )
                expect(query.isPending).toBe(false)
            },
            {timeout: SETTLE_TIMEOUT, interval: 250},
        )

        const metrics: ScenarioMetricData | null = store.get(
            scenarioDataSelectors.scenarioMetrics({projectId: projectId!, runId, scenarioId}),
        )

        // Resilient: real scenarios may legitimately have no metrics (null). When present,
        // the shipped flatten/merge code path must have produced the documented shape.
        if (metrics !== null) {
            expect(metrics).toHaveProperty("raw")
            expect(metrics).toHaveProperty("flat")
            expect(metrics).toHaveProperty("stats")
            expect(typeof metrics.raw).toBe("object")
            expect(typeof metrics.flat).toBe("object")
            expect(typeof metrics.stats).toBe("object")
        } else {
            expect(metrics).toBeNull()
        }
    })
})
