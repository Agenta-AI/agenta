/**
 * @agenta/evaluations/core
 *
 * Pure, headless evaluation-run construction. No jotai, no React, no network.
 */
export {buildRunConfig} from "./buildRunConfig"
export {slugify} from "./slugify"
export {extractEvaluatorMetricKeys} from "./extractEvaluatorMetricKeys"
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
