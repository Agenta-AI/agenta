/**
 * @agenta/entities/evaluationScenario
 *
 * First-class evaluation scenario entity (one row of a run). Core schema, Fern api, and a
 * reactive `{projectId, runId}`-keyed molecule. Promoted out of `evaluationRun` so the
 * scenario is a standalone entity (per the evaluations→packages migration plan).
 *
 * @packageDocumentation
 */

export {
    evaluationScenarioSchema,
    type EvaluationScenario,
    evaluationScenariosResponseSchema,
    type EvaluationScenariosResponse,
    type EvaluationScenarioListParams,
    type EvaluationScenarioStatusInput,
    type SetEvaluationScenarioStatusesParams,
    type ScenarioListKey,
} from "./core"

export {queryEvaluationScenarios, setEvaluationScenarioStatuses} from "./api"

export {evaluationScenarioMolecule, evaluationScenariosQueryAtomFamily} from "./state/molecule"
