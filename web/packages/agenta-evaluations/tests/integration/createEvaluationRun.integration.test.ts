/**
 * Integration tests for the createEvaluationRun controller against a real backend.
 *
 * Skipped unless AGENTA_API_URL + AGENTA_AUTH_KEY are set (globalSetup mints an ephemeral
 * account; setup/worker.ts authenticates the Fern client the controller uses).
 *
 *   AGENTA_API_URL=http://localhost/api \
 *   AGENTA_AUTH_KEY=<admin key> \
 *   pnpm --filter @agenta/evaluations run test:integration
 *
 * The controller's orchestration BRANCHES (success / scenario-fail→rollback /
 * results-fail→rollback / rollback-fail) are exhaustively unit-tested with a fake client.
 * These integration tests pin the parts a fake can't: that the real backend accepts the
 * DIFFERENT TYPES of evaluation run this controller produces, and that deleteRuns (the
 * rollback cleanup primitive) actually removes a run.
 *
 * Types covered = what THIS controller creates (the batch/preview path). The type marker
 * in the create payload is `meta.evaluation_kind` + the annotation-step `origin`
 * (human vs auto); run flags like is_live are backend-derived, not a create input. Online
 * evaluations use a different endpoint (createSimpleEvaluation) and are out of scope here.
 *
 * NOTE: annotation-step `references` are left empty so no evaluator/testset FK fixtures are
 * required. If the backend starts enforcing evaluator references at create time, enrich the
 * builder below with real evaluator-revision refs (and a beforeAll that seeds them).
 */
import {fetchEvaluationRun} from "@agenta/entities/evaluationRun"
import {getAgentaSdkClient} from "@agenta/sdk"
import {afterEach, describe, expect, it} from "vitest"

import {createEvaluationRun} from "../../src/controllers/createEvaluationRun"
import type {RunConfig, RunStep} from "../../src/core/types"

import {TEST_CONFIG, hasBackend} from "./helpers/env"

const projectId = TEST_CONFIG.projectId

/**
 * Build a run config for a given evaluation type. `annotationOrigin` undefined means a
 * run with no evaluator (input + invocation only).
 */
function buildRunConfig({
    evaluationKind,
    annotationOrigin,
}: {
    evaluationKind: string
    annotationOrigin?: "human" | "auto"
}): RunConfig {
    const inputKey = "testset-integration"
    const invocationKey = "invocation-integration"
    const steps: RunStep[] = [
        {key: inputKey, type: "input", origin: "auto", references: {}},
        {
            key: invocationKey,
            type: "invocation",
            origin: "human",
            references: {},
            inputs: [{key: inputKey}],
        },
    ]
    if (annotationOrigin) {
        steps.push({
            key: `${invocationKey}.evaluator`,
            type: "annotation",
            origin: annotationOrigin,
            references: {},
            inputs: [{key: inputKey}, {key: invocationKey}],
        })
    }
    return {
        key: `evaluation-${evaluationKind}`,
        name: `integration-${evaluationKind}-${Date.now()}`,
        meta: {source: "integration-test", evaluation_kind: evaluationKind},
        data: {steps, mappings: []},
    }
}

const EVALUATION_TYPES: {
    label: string
    evaluationKind: string
    annotationOrigin?: "human" | "auto"
    expectedStepCount: number
}[] = [
    {
        label: "human evaluation",
        evaluationKind: "human",
        annotationOrigin: "human",
        expectedStepCount: 3,
    },
    {
        label: "auto evaluation",
        evaluationKind: "auto",
        annotationOrigin: "auto",
        expectedStepCount: 3,
    },
    {label: "run without evaluators", evaluationKind: "human", expectedStepCount: 2},
]

async function deleteRun(runId: string): Promise<void> {
    await getAgentaSdkClient().evaluations.deleteRuns(
        {run_ids: [runId]},
        {queryParams: {project_id: projectId}},
    )
}

describe.skipIf(!hasBackend)("createEvaluationRun integration", () => {
    const createdRunIds: string[] = []

    afterEach(async () => {
        await Promise.all(createdRunIds.splice(0).map((id) => deleteRun(id).catch(() => undefined)))
    })

    it.each(EVALUATION_TYPES)(
        "creates a $label and round-trips its type marker + step shape",
        async ({evaluationKind, annotationOrigin, expectedStepCount}) => {
            const result = await createEvaluationRun({
                projectId,
                runs: [buildRunConfig({evaluationKind, annotationOrigin})],
                testcaseIds: [],
            })
            createdRunIds.push(result.runId)

            expect(result.status).toBe("created")
            expect(result.runId).toBeTruthy()

            const fetched = await fetchEvaluationRun({id: result.runId, projectId})
            expect(fetched).not.toBeNull()
            expect(fetched?.id).toBe(result.runId)

            // Type marker survives the round-trip (meta passthrough preserves it).
            const meta = (fetched?.meta ?? {}) as Record<string, unknown>
            expect(meta.evaluation_kind).toBe(evaluationKind)

            // Step shape persists (and the annotation origin distinguishes the type).
            const steps = fetched?.data?.steps ?? []
            expect(steps).toHaveLength(expectedStepCount)
            if (annotationOrigin) {
                const annotation = steps.find((s) => s.type === "annotation")
                expect(annotation?.origin).toBe(annotationOrigin)
            }
        },
    )

    it("deleteRuns removes a run (the rollback cleanup primitive)", async () => {
        const result = await createEvaluationRun({
            projectId,
            runs: [buildRunConfig({evaluationKind: "human"})],
            testcaseIds: [],
        })

        await deleteRun(result.runId)

        const afterDelete = await fetchEvaluationRun({id: result.runId, projectId})
        expect(afterDelete).toBeNull()
    })
})
