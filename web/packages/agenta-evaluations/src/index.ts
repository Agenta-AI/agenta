/**
 * @agenta/evaluations
 *
 * State + logic package for evaluations / evaluation runs, migrated out of the OSS
 * app. Mirrors the @agenta/annotation split: headless logic here, React UI in
 * @agenta/evaluations-ui. Run/queue/result/metric data molecules live in
 * @agenta/entities; this package owns run-config construction, the run-creation
 * controller, and the run table store.
 *
 * Current surface: pure run-config construction (core) + the run-creation controller.
 *
 * @packageDocumentation
 */

export {
    buildRunConfig,
    slugify,
    extractEvaluatorMetricKeys,
    buildRunIndex,
    isOnlineEvaluation,
    isHumanEvaluation,
    isCustomEvaluation,
    deriveEvaluationKind,
    type BuildRunConfigInput,
    type BuildRunConfigResult,
    type RevisionSchemaContext,
    type RunConfig,
    type RunConfigTestset,
    type RunMapping,
    type RunStep,
    type RunStepOrigin,
    type RunStepType,
    type StepKind,
    type ColumnDef,
    type StepMeta,
    type RunIndex,
    type EvaluationRunKind,
    type EvaluationStepForKindDetection,
    type EvaluationRunForKindDetection,
} from "./core"

export {
    createEvaluationRun,
    buildScenarioStepResults,
    EvaluationRunCreationError,
    type EvaluationsCreateClient,
    type CreateEvaluationRunArgs,
    type CreateEvaluationRunResult,
    type CreateEvaluationRunStage,
} from "./controllers"
