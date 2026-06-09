/**
 * @agenta/evaluations — generic metric/schema-extraction module.
 *
 * Pure functions relocated faithfully from the annotation form controller:
 * schema → metric-field extraction, and evaluator resolution + baseline
 * computation. Entities-only (`@agenta/entities/workflow` + `annotation` types).
 * No `@agenta/annotation` import, no queue/session/form-edit state, no atoms.
 * `resolveEvaluators`/`computeBaseline` take a jotai `Getter` from the consumer's
 * store.
 */

// Schema-extraction helpers
export {
    getMetricFieldsFromEvaluator,
    getMetricsFromAnnotation,
    getOutputsSchema,
    USEABLE_METRIC_TYPES,
} from "./schema"

// Evaluator resolution + baseline computation
export {computeBaseline, normalizeResolvedEvaluator, resolveEvaluators} from "./evaluators"

// Types
// NOTE: `EvaluatorStepRef` is intentionally NOT re-exported here — it already
// ships from the `scenarioData` barrel, and this module reuses that single
// definition. Re-exporting it again would create an ambiguous star re-export at
// `state/index.ts`.
export type {
    BaselineComputationResult,
    EvaluatorResolutionState,
    MetricField,
    MetricsByEvaluator,
    ResolvedEvaluatorRef,
    ResolvedEvaluators,
} from "./types"
