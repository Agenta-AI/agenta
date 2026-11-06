/**
 * Run details selectors: the header facts and the references of one run, read from the run query
 * that already exists. They send no request of their own, and they never write: opening a run
 * page must not change the run.
 *
 * @packageDocumentation
 */

import {atom} from "jotai"
import {atomFamily} from "jotai-family"

import {
    deriveEvaluationKind,
    runDisplayStatus,
    type EvaluationRunDataStep,
    type EvaluationRunKind,
} from "../core"

import {evaluationRunQueryAtomFamily} from "./molecule"

export interface RunHeader {
    /** The run name, else the run id. */
    name: string
    description: string | null
    /** The status to show: `paused` for a live run that is paused, else the run's own status. */
    status: string | null
    kind: EvaluationRunKind
    flags: {isLive: boolean; isClosed: boolean; isActive: boolean}
    createdAt: string | null
    updatedAt: string | null
    createdById: string | null
}

export interface RunTestsetReference {
    testsetId: string
    revisionId: string | null
    /** The test set revision's version number, from the run's step reference. */
    version: number | null
}

export interface RunEvaluatorReference {
    evaluatorId: string
    revisionId: string | null
    slug: string | null
    stepKey: string
}

export interface RunReferences {
    applicationId: string | null
    variantId: string | null
    revisionId: string | null
    revisionVersion: number | null
    testsets: RunTestsetReference[]
    evaluators: RunEvaluatorReference[]
    queryIds: string[]
}

const flag = (flags: Record<string, unknown> | null | undefined, key: string) =>
    flags?.[key] === true

export const runHeaderAtomFamily = atomFamily((runId: string) =>
    atom<RunHeader | null>((get) => {
        const run = get(evaluationRunQueryAtomFamily(runId)).data
        if (!run) return null
        return {
            name: run.name?.trim() || run.id,
            description: run.description ?? null,
            status: runDisplayStatus(run),
            kind: deriveEvaluationKind(run),
            flags: {
                isLive: flag(run.flags, "is_live"),
                isClosed: flag(run.flags, "is_closed"),
                isActive: flag(run.flags, "is_active"),
            },
            createdAt: run.created_at ?? null,
            updatedAt: run.updated_at ?? null,
            createdById: run.created_by_id ?? null,
        }
    }),
)

const refId = (step: EvaluationRunDataStep, name: string) => step.references?.[name]?.id ?? null

export const runReferencesAtomFamily = atomFamily((runId: string) =>
    atom<RunReferences | null>((get) => {
        const run = get(evaluationRunQueryAtomFamily(runId)).data
        if (!run) return null
        const steps = run.data?.steps ?? []
        const invocation = steps.find(
            (step) => step.type === "invocation" && refId(step, "application"),
        )
        const inputs = steps.filter((step) => step.type === "input")
        return {
            applicationId: invocation ? refId(invocation, "application") : null,
            variantId: invocation ? refId(invocation, "application_variant") : null,
            revisionId: invocation ? refId(invocation, "application_revision") : null,
            revisionVersion: invocation?.references?.application_revision?.version ?? null,
            testsets: inputs.flatMap((step) => {
                const testsetId = refId(step, "testset")
                return testsetId
                    ? [
                          {
                              testsetId,
                              revisionId: refId(step, "testset_revision"),
                              version: step.references?.testset_revision?.version ?? null,
                          },
                      ]
                    : []
            }),
            evaluators: steps.flatMap((step) => {
                const evaluatorId = step.type === "annotation" ? refId(step, "evaluator") : null
                return evaluatorId
                    ? [
                          {
                              evaluatorId,
                              revisionId: refId(step, "evaluator_revision"),
                              slug: step.references?.evaluator?.slug ?? null,
                              stepKey: step.key,
                          },
                      ]
                    : []
            }),
            queryIds: inputs.flatMap((step) => {
                const queryId = refId(step, "query")
                return queryId ? [queryId] : []
            }),
        }
    }),
)
