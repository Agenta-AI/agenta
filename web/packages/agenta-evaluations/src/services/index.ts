/**
 * @agenta/evaluations/services
 *
 * Active evaluation mutation / query service APIs, relocated from
 * `web/oss/src/services/evaluations/`. Fully Fern-backed via @agenta/entities
 * (except `workerUtils`, which talks to the API over raw `fetch` from a
 * WebWorker / non-axios context).
 *
 * NOTE: `updateScenarioStatus` exists in BOTH `scenarios` and `invocations`
 * with different status signatures (string vs EvaluationStatus). To preserve
 * both, import them from their dedicated subpaths
 * (`@agenta/evaluations/services/scenarios` / `.../invocations`) rather than
 * this barrel. This barrel re-exports the non-colliding symbols only.
 *
 * @packageDocumentation
 */

export {
    queryStepResults,
    upsertStepResultWithAnnotation,
    type StepResult,
    type QueryResultsParams,
} from "./results"

export {checkAndUpdateRunStatus} from "./scenarios"

export {upsertStepResultWithInvocation, type InvocationReferences} from "./invocations"

export {updateScenarioStatusRemote, upsertScenarioStep} from "./workerUtils"

export {
    editEvaluationRunShape,
    processEvaluationRunSlice,
    queryRunScenarioIds,
    type EvaluatorOrigin,
    type StepTargets,
    type EditRunShapeArgs,
    type ProcessSliceArgs,
} from "./runShape"
