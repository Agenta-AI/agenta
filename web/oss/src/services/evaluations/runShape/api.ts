/**
 * Run-shape API: thin Fern-client wrappers for mutating an existing evaluation
 * run's shape (width/height/depth) plus the slice processor that fills cells.
 *
 * These are the ONLY place the Fern client is called for this feature — UI and
 * atoms go through the jotai mutation atoms in
 * `EvalRunDetails/atoms/mutations/editEvaluation`, never the client directly.
 *
 * "Add evaluator to a finished run" is two server calls:
 *   1) editSimpleEvaluation(evaluator_steps + new) — the server rebuilds the run
 *      data (steps AND metric mappings) from the revision ids, byte-identical to
 *      create; existing steps keep their keys so existing cells survive.
 *   2) processSlice(scenario_ids, overwrite:false) — fills only the missing cells
 *      (the new evaluator) against the already-stored app outputs. NOTE: the
 *      processor derives scenarios from the addressed step's existing cells, so a
 *      brand-new step needs EXPLICIT scenario_ids or it no-ops.
 */
import {getEvaluationsClient} from "@agenta/sdk/resources"

export type EvaluatorOrigin = "custom" | "human" | "auto"

const client = () => getEvaluationsClient()

/**
 * Step targets as `{revisionId: origin}`. ALWAYS send the run's existing origins — the
 * server defaults a bare id list to origin="custom" (DEFAULT_ORIGIN_* in service.py),
 * which would flip an "auto" run to "custom"/SDK in the kind derivation.
 */
export type StepTargets = Record<string, EvaluatorOrigin>

export interface EditRunShapeArgs {
    projectId: string
    runId: string
    testsetSteps: StepTargets
    applicationSteps: StepTargets
    evaluatorSteps: StepTargets
    querySteps?: StepTargets
    /**
     * Run name/description. ALWAYS pass the current values (even unchanged): the edit
     * endpoint replaces them, so omitting clears them. The caller seeds these from the
     * run and only mutates on user edits.
     */
    name?: string | null
    description?: string | null
}

/**
 * Replace the run's name/description + input/evaluator targets; the server rebuilds
 * steps+mappings. Send the COMPLETE evaluator set (existing + new) — edit replaces,
 * it does not merge.
 */
export const editEvaluationRunShape = ({
    projectId,
    runId,
    testsetSteps,
    applicationSteps,
    evaluatorSteps,
    querySteps,
    name,
    description,
}: EditRunShapeArgs) =>
    client().editSimpleEvaluation(
        {
            evaluation_id: runId,
            evaluation: {
                id: runId,
                ...(name !== undefined ? {name} : {}),
                ...(description !== undefined ? {description} : {}),
                data: {
                    ...(querySteps && Object.keys(querySteps).length
                        ? {query_steps: querySteps}
                        : {}),
                    testset_steps: testsetSteps,
                    application_steps: applicationSteps,
                    evaluator_steps: evaluatorSteps,
                },
            },
        },
        {queryParams: {project_id: projectId}},
    )

export interface ProcessSliceArgs {
    projectId: string
    runId: string
    scenarioIds: string[]
    /** Omit/empty to address every step (fill-missing across the run). */
    stepKeys?: string[]
    overwrite?: boolean
}

export const processEvaluationRunSlice = ({
    projectId,
    runId,
    scenarioIds,
    stepKeys,
    overwrite = false,
}: ProcessSliceArgs) =>
    client().processSlice(
        {
            evaluation_id: runId,
            scenario_ids: scenarioIds,
            ...(stepKeys && stepKeys.length ? {step_keys: stepKeys} : {}),
            overwrite,
        },
        {queryParams: {project_id: projectId}},
    )

/** All scenario ids for a run — required to scope `process` over a new step. */
export const queryRunScenarioIds = async ({
    projectId,
    runId,
}: {
    projectId: string
    runId: string
}): Promise<string[]> => {
    const res = await client().queryScenarios(
        {scenario: {run_id: runId}, windowing: {limit: 1000}},
        {queryParams: {project_id: projectId}},
    )
    return (res.scenarios ?? [])
        .map((scenario) => scenario.id)
        .filter((id): id is string => Boolean(id))
}
