/**
 * @agenta/evaluations/core
 *
 * Pure, headless evaluation-run construction. No jotai, no React, no network.
 */
export {buildRunConfig} from "./buildRunConfig"
export {slugify} from "./slugify"
export {extractEvaluatorMetricKeys} from "./extractEvaluatorMetricKeys"
export {buildRunIndex, serializeRunIndex, deserializeRunIndex} from "./buildRunIndex"
export type {StepKind, ColumnDef, StepMeta, RunIndex} from "./buildRunIndex"
export {
    isOnlineEvaluation,
    isHumanEvaluation,
    isCustomEvaluation,
    deriveEvaluationKind,
    normalizeEvaluationKindString,
    getEvaluationKindWithFallback,
} from "./evaluationKind"
export type {
    EvaluationRunKind,
    EvaluationStepForKindDetection,
    EvaluationRunForKindDetection,
} from "./evaluationKind"
export type {
    BuildRunConfigInput,
    BuildRunConfigResult,
    RevisionSchemaContext,
    RunConfig,
    RunConfigTestset,
    RunMapping,
    RunStep,
    RunStepOrigin,
    RunStepType,
} from "./types"
