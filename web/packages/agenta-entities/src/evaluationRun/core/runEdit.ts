/**
 * The request body that changes a run's name and description and adds evaluators to it, copied
 * from the old app's
 * `saveEvaluationEditAtom` (`EvalRunDetails/atoms/mutations/editEvaluation.ts`).
 *
 * `PATCH /simple/evaluations/{id}` replaces the run's data, so the body sends every step the run
 * already has, each with its own origin. A bare id list would reset the origins to "custom" and
 * turn an auto run into an SDK run.
 *
 * @packageDocumentation
 */

import type {EvaluationRunDataStep} from "./schema"

export type RunStepOrigin = "custom" | "human" | "auto"

export interface RunEditInput {
    id: string
    data?: {steps?: readonly EvaluationRunDataStep[] | null} | null
}

export interface RunEditBody {
    evaluation: {
        id: string
        name: string
        description: string
        data: {
            query_steps?: Record<string, RunStepOrigin>
            testset_steps: Record<string, RunStepOrigin>
            application_steps: Record<string, RunStepOrigin>
            evaluator_steps: Record<string, RunStepOrigin>
        }
    }
}

/** `{revisionId: origin}` for the steps of one type that reference `refKey`. */
function stepOrigins(
    steps: readonly EvaluationRunDataStep[],
    type: EvaluationRunDataStep["type"],
    refKey: string,
    fallback: RunStepOrigin,
): Record<string, RunStepOrigin> {
    const origins: Record<string, RunStepOrigin> = {}
    for (const step of steps) {
        if (step.type !== type) continue
        const id = step.references?.[refKey]?.id
        if (id) origins[id] = step.origin ?? fallback
    }
    return origins
}

/**
 * The body that renames a run and sets its description, keeping its steps as they are. Added
 * evaluator revisions join the run with the origin of its first evaluator step, as in the old app,
 * so a human run stays human; a revision the run already has keeps its own step.
 */
export function buildRunEditBody(
    run: RunEditInput,
    {
        name,
        description,
        addedEvaluatorRevisionIds = [],
    }: {name: string; description: string; addedEvaluatorRevisionIds?: readonly string[]},
): RunEditBody {
    const steps = run.data?.steps ?? []
    const evaluatorOrigin = steps.find((step) => step.type === "annotation")?.origin ?? "auto"
    const querySteps = stepOrigins(steps, "input", "query_revision", "auto")
    const evaluatorSteps = stepOrigins(steps, "annotation", "evaluator_revision", evaluatorOrigin)
    for (const id of addedEvaluatorRevisionIds) {
        if (!(id in evaluatorSteps)) evaluatorSteps[id] = evaluatorOrigin
    }
    return {
        evaluation: {
            id: run.id,
            name,
            description,
            data: {
                ...(Object.keys(querySteps).length ? {query_steps: querySteps} : {}),
                testset_steps: stepOrigins(steps, "input", "testset_revision", "auto"),
                application_steps: stepOrigins(steps, "invocation", "application_revision", "auto"),
                evaluator_steps: evaluatorSteps,
            },
        },
    }
}
