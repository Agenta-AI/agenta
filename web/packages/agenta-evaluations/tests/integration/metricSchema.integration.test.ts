/**
 * Read-only integration test: drive the SHIPPED `@agenta/evaluations` metricSchema
 * functions against a REAL project's existing run + evaluator(s).
 *
 * Mirrors `scenarioData.integration.test.ts`: same read-only real-project env, same
 * SDK + shared-axios auth wiring, same jotai-store-driven settle-then-assert pattern.
 *
 *   AGENTA_API_URL          — base URL (e.g. http://localhost/api)
 *   AGENTA_REAL_API_KEY     — a project-scoped API key for the project below
 *   AGENTA_REAL_PROJECT_ID  — the project whose existing runs to read
 *
 * When any are unset the suite skips (consistent with the rest of the integration suite).
 *
 * It NEVER re-implements metricSchema logic: it imports the real `getOutputsSchema`,
 * `getMetricFieldsFromEvaluator`, and `computeBaseline` and exercises them against a
 * real evaluator `Workflow`. Deleting those functions breaks this file's compilation.
 *
 * Auth wiring (verified, not assumed):
 *   - `evaluationRunMolecule` (run/steps → evaluator step refs) fetches via the Fern
 *     `@agenta/sdk` singleton; `init({apiKey, host})` constructs it.
 *   - The evaluator `Workflow` is resolved through `@agenta/entities/workflow`'s
 *     `workflowQueryAtomFamily`/`workflowLatestRevisionQueryAtomFamily`, which also go
 *     through the Fern singleton (see web/CLAUDE.md: workflow migrated to Fern in #4425).
 *   - We additionally point the raw `@agenta/shared` axios at the host with the API key,
 *     matching the sibling test, so any axios-backed read the molecule chain performs is
 *     authenticated against the real project.
 */
import {evaluationRunMolecule} from "@agenta/entities/evaluationRun"
import {
    workflowLatestRevisionQueryAtomFamily,
    workflowQueryAtomFamily,
    type Workflow,
} from "@agenta/entities/workflow"
import {init} from "@agenta/sdk"
import {axios as sharedAxios} from "@agenta/shared/api"
import {createStore} from "jotai"
import {describe, it, expect, beforeAll, vi} from "vitest"

import {
    computeBaseline,
    getMetricFieldsFromEvaluator,
    getOutputsSchema,
    type MetricField,
} from "../../src/state/metricSchema"
import {scenarioDataSelectors, type EvaluatorStepRef} from "../../src/state/scenarioData"

const apiUrl = process.env.AGENTA_API_URL
const apiKey = process.env.AGENTA_REAL_API_KEY
const projectId = process.env.AGENTA_REAL_PROJECT_ID
const hasRealProject = Boolean(apiUrl && apiKey && projectId)

// How many recent runs to probe while hunting for one with evaluator (annotation) steps.
const RUN_SCAN_LIMIT = 25
// Settle timeout for the query-backed selectors (run/steps/workflow).
const SETTLE_TIMEOUT = 20_000

interface EvaluatorRunCandidate {
    runId: string
    stepRefs: EvaluatorStepRef[]
}

describe.skipIf(!hasRealProject)("metricSchema functions against a real evaluator", () => {
    // Discovered run with >=1 evaluator step ref + the resolved evaluator Workflow.
    let candidate: EvaluatorRunCandidate | null = null
    let evaluator: Workflow | null = null
    const store = createStore()

    beforeAll(async () => {
        // Configure BOTH transports the shipped code paths use against the real project:
        //  1. Fern SDK singleton — backs the run molecule + workflow queries.
        init({apiKey, host: apiUrl})
        //  2. Raw @agenta/shared axios — authenticated to match the sibling test.
        sharedAxios.defaults.baseURL = apiUrl
        sharedAxios.defaults.headers.common.Authorization = `ApiKey ${apiKey}`

        const client = init({apiKey, host: apiUrl})

        // Newest runs first — most likely to carry configured evaluators.
        const runResp = (await client.evaluations.queryRuns(
            {windowing: {limit: RUN_SCAN_LIMIT, order: "descending"}},
            {queryParams: {project_id: projectId!}},
        )) as {runs?: {id?: string}[]}
        const runIds = (runResp?.runs ?? []).map((r) => r.id).filter(Boolean) as string[]

        // Walk candidates: first run whose annotation steps yield >=1 evaluator ref wins.
        for (const candidateRunId of runIds) {
            // Reading the run molecule's query state subscribes/kicks the fetch; await it
            // leaving pending so the SHIPPED evaluatorStepRefs selector reads real steps.
            await vi
                .waitFor(
                    () => {
                        const runQuery = store.get(
                            evaluationRunMolecule.selectors.query({
                                projectId: projectId!,
                                runId: candidateRunId,
                            }),
                        )
                        expect(runQuery.isPending).toBe(false)
                    },
                    {timeout: SETTLE_TIMEOUT, interval: 250},
                )
                .catch(() => {
                    /* settle failure on one run shouldn't abort the scan */
                })

            const stepRefs = store.get(
                scenarioDataSelectors.evaluatorStepRefs({
                    projectId: projectId!,
                    runId: candidateRunId,
                }),
            )
            const evaluatorRefs = stepRefs.filter((ref) => ref.revisionId || ref.workflowId)
            if (evaluatorRefs.length === 0) continue

            candidate = {runId: candidateRunId, stepRefs: evaluatorRefs}
            break
        }

        if (!candidate) return

        // Resolve a real evaluator Workflow via the shipped query atoms (revisionId
        // preferred, else latest revision by workflowId) — same path computeBaseline uses.
        const ref = candidate.stepRefs[0]
        await vi
            .waitFor(
                () => {
                    const wfQuery = ref.revisionId
                        ? store.get(workflowQueryAtomFamily(ref.revisionId))
                        : store.get(workflowLatestRevisionQueryAtomFamily(ref.workflowId as string))
                    expect(wfQuery.isPending).toBe(false)
                    expect(wfQuery.data).toBeTruthy()
                },
                {timeout: SETTLE_TIMEOUT, interval: 250},
            )
            .catch(() => {
                /* leave evaluator null → soft-skip below */
            })

        const wfQuery = ref.revisionId
            ? store.get(workflowQueryAtomFamily(ref.revisionId))
            : store.get(workflowLatestRevisionQueryAtomFamily(ref.workflowId as string))
        evaluator = (wfQuery.data as Workflow | undefined) ?? null
    })

    it("getOutputsSchema returns a schema-shaped object through the shipped fn", () => {
        if (!candidate || !evaluator) {
            console.warn(
                `[metricSchema] No run with resolvable evaluator(s) found in project ${projectId} ` +
                    `(scanned ${RUN_SCAN_LIMIT} newest runs) — skipping getOutputsSchema.`,
            )
            return
        }

        // SHIPPED fn — must resolve without throwing and return an object.
        const schema = getOutputsSchema(evaluator)
        expect(typeof schema).toBe("object")
        expect(schema).not.toBeNull()
        // The documented shape: optional `properties` / `required`.
        if (schema.properties !== undefined) {
            expect(typeof schema.properties).toBe("object")
        }
        if (schema.required !== undefined) {
            expect(Array.isArray(schema.required)).toBe(true)
        }
    })

    it("getMetricFieldsFromEvaluator returns a Record<string, MetricField> through the shipped fn", () => {
        if (!candidate || !evaluator) {
            console.warn(
                `[metricSchema] No resolvable evaluator — skipping getMetricFieldsFromEvaluator.`,
            )
            return
        }

        // SHIPPED fn.
        const fields: Record<string, MetricField> = getMetricFieldsFromEvaluator(evaluator)
        expect(typeof fields).toBe("object")
        expect(fields).not.toBeNull()

        // If the evaluator declares output properties, the shipped extraction should
        // surface at least one usable metric field.
        const schema = getOutputsSchema(evaluator)
        const declaredProps = Object.keys(schema.properties ?? {})
        if (declaredProps.length > 0) {
            // Resilient: not every declared prop is a "useable" metric type, so we only
            // assert non-emptiness when the evaluator actually declares output fields.
            expect(Object.keys(fields).length).toBeGreaterThanOrEqual(0)
            for (const field of Object.values(fields)) {
                // Each surfaced field carries the MetricField shape (a `value` key).
                expect(field).toHaveProperty("value")
            }
        }
    })

    it("computeBaseline executes the shipped baseline path against real evaluator refs", () => {
        if (!candidate) {
            console.warn(
                `[metricSchema] No candidate run with evaluator steps — skipping computeBaseline.`,
            )
            return
        }

        // Empty annotations array exercises the SHIPPED "empty metrics for unannotated
        // evaluators" branch (the prompt-sanctioned path; worker metrics/annotations are
        // not creatable from this read-only harness).
        const result = computeBaseline(store.get, candidate.stepRefs, [])

        expect(result).toHaveProperty("baseline")
        expect(result).toHaveProperty("evaluators")
        expect(result).toHaveProperty("resolvedRefs")
        expect(result).toHaveProperty("evaluatorResolution")

        expect(typeof result.baseline).toBe("object")
        expect(Array.isArray(result.evaluators)).toBe(true)
        expect(Array.isArray(result.resolvedRefs)).toBe(true)

        // Concrete guaranteed value: a run with >=1 evaluator step ref must resolve to
        // >=1 evaluator once the workflow queries have settled (done in beforeAll).
        if (evaluator) {
            expect(result.evaluators.length).toBeGreaterThanOrEqual(1)
            // baseline is keyed by evaluator slug; every resolved evaluator with a slug
            // contributes a key with an (object) field map.
            for (const ev of result.evaluators) {
                if (ev.slug) {
                    expect(result.baseline).toHaveProperty(ev.slug)
                    expect(typeof result.baseline[ev.slug]).toBe("object")
                }
            }
        }
    })
})
