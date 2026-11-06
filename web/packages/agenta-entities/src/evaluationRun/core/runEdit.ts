/**
 * The request body that changes a run's name and description, copied from the old app's
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

/** The body that renames a run and sets its description, keeping its steps as they are. */
export function buildRunEditBody(
    run: RunEditInput,
    {name, description}: {name: string; description: string},
): RunEditBody {
    const steps = run.data?.steps ?? []
    const evaluatorOrigin = steps.find((step) => step.type === "annotation")?.origin ?? "auto"
    const querySteps = stepOrigins(steps, "input", "query_revision", "auto")
    return {
        evaluation: {
            id: run.id,
            name,
            description,
            data: {
                ...(Object.keys(querySteps).length ? {query_steps: querySteps} : {}),
                testset_steps: stepOrigins(steps, "input", "testset_revision", "auto"),
                application_steps: stepOrigins(steps, "invocation", "application_revision", "auto"),
                evaluator_steps: stepOrigins(
                    steps,
                    "annotation",
                    "evaluator_revision",
                    evaluatorOrigin,
                ),
            },
        },
    }
}
