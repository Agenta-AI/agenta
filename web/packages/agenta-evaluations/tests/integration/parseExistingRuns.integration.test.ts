/**
 * Read-only drift smoke test: parse a real project's EXISTING evaluation runs through the
 * production Zod schema (`evaluationRunSchema`).
 *
 * This is the test class that would have caught the mapping-kind enum regression: it reads
 * runs created by the real UI over time (with the real, drifting backend taxonomy) rather
 * than freshly-minted ephemeral runs. It NEVER writes — pure GET/query against an existing
 * project, so it is safe to point at a real (even production) project with a read-scoped key.
 *
 * Required env (kept separate from the ephemeral-account vars so the two flows don't collide):
 *   AGENTA_API_URL          — base URL (e.g. http://localhost/api)
 *   AGENTA_REAL_API_KEY     — a project-scoped API key for the project below
 *   AGENTA_REAL_PROJECT_ID  — the project whose existing runs to validate
 *
 * When any are unset the suite skips (consistent with the rest of the integration suite).
 */
import {init} from "@agenta/sdk"
import {evaluationMetricSchema, evaluationRunSchema} from "@agenta/entities/evaluationRun"
import {describe, it, expect} from "vitest"

const apiUrl = process.env.AGENTA_API_URL
const apiKey = process.env.AGENTA_REAL_API_KEY
const projectId = process.env.AGENTA_REAL_PROJECT_ID
const hasRealProject = Boolean(apiUrl && apiKey && projectId)

// How many existing runs to sample. The table loads a windowed page, so a few hundred is a
// representative sweep without pulling an unbounded history.
const SAMPLE_LIMIT = 300

describe.skipIf(!hasRealProject)("existing runs parse against the production schema", () => {
    it(`every run in project ${projectId} round-trips through evaluationRunSchema`, async () => {
        const client = init({apiKey, host: apiUrl})

        // Raw query (no entity-layer parsing) so we can validate EACH run individually and
        // report exactly which run/field drifted — `queryEvaluationRuns` collapses a single
        // bad run into an empty array, which hides the offender.
        const response = (await client.evaluations.queryRuns(
            {windowing: {limit: SAMPLE_LIMIT, order: "descending"}},
            {queryParams: {project_id: projectId!}},
        )) as {count?: number; runs?: unknown[]}

        const runs = Array.isArray(response?.runs) ? response.runs : []
        expect(runs.length, "project has at least one existing run to validate").toBeGreaterThan(0)

        const failures: {id: unknown; issues: string[]}[] = []
        for (const run of runs) {
            const parsed = evaluationRunSchema.safeParse(run)
            if (!parsed.success) {
                failures.push({
                    id: (run as {id?: unknown})?.id,
                    issues: parsed.error.issues
                        .slice(0, 8)
                        .map((i) => `${i.path.join(".")}: ${i.message}`),
                })
            }
        }

        if (failures.length > 0) {
            // Surface the offending runs/fields so schema drift is actionable, not a mystery.
            console.error(
                `[parseExistingRuns] ${failures.length}/${runs.length} runs failed schema validation:\n` +
                    JSON.stringify(failures, null, 2),
            )
        }
        expect(failures, "all existing runs must satisfy evaluationRunSchema").toHaveLength(0)
    })

    // Metrics can't be created in the ephemeral harness (worker-computed), so verify the
    // migrated metrics path against real data: send the EXACT payload queryEvaluationMetricsBatch
    // sends ({metrics:{run_ids, scenario_ids:false}}) and assert every returned metric parses
    // through evaluationMetricSchema (the schema the Fern path validates with).
    it("existing run metrics parse through evaluationMetricSchema", async () => {
        const client = init({apiKey, host: apiUrl})

        const runResp = (await client.evaluations.queryRuns(
            {windowing: {limit: 50, order: "descending"}},
            {queryParams: {project_id: projectId!}},
        )) as {runs?: {id?: string}[]}
        const runIds = (runResp?.runs ?? []).map((r) => r.id).filter(Boolean) as string[]
        expect(runIds.length).toBeGreaterThan(0)

        const metricsResp = (await client.evaluations.queryMetrics(
            {metrics: {run_ids: runIds, scenario_ids: false}} as never,
            {queryParams: {project_id: projectId!}},
        )) as {metrics?: unknown[]}
        const metrics = Array.isArray(metricsResp?.metrics) ? metricsResp.metrics : []

        // The project has computed metrics (the run table shows metric columns).
        expect(metrics.length, "project should have computed metrics").toBeGreaterThan(0)

        const failures: {id: unknown; issues: string[]}[] = []
        for (const metric of metrics) {
            const parsed = evaluationMetricSchema.safeParse(metric)
            if (!parsed.success) {
                failures.push({
                    id: (metric as {id?: unknown})?.id,
                    issues: parsed.error.issues
                        .slice(0, 8)
                        .map((i) => `${i.path.join(".")}: ${i.message}`),
                })
            }
        }
        if (failures.length > 0) {
            console.error(
                `[parseExistingRuns] ${failures.length}/${metrics.length} metrics failed validation:\n` +
                    JSON.stringify(failures, null, 2),
            )
        }
        expect(failures, "all existing metrics must satisfy evaluationMetricSchema").toHaveLength(0)
    })
})
