/**
 * @agenta/entities/evaluationRun
 *
 * Evaluation run entity — read-only access to evaluation run data
 * with automatic batch fetching for individual run queries.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { evaluationRunMolecule } from '@agenta/entities/evaluationRun'
 *
 * // Read run data (batch-fetched automatically)
 * const data = useAtomValue(evaluationRunMolecule.selectors.data(runId))
 *
 * // Get annotation steps (evaluators)
 * const steps = useAtomValue(evaluationRunMolecule.selectors.annotationSteps(runId))
 *
 * // Get evaluator workflow IDs from annotation step references
 * const ids = useAtomValue(evaluationRunMolecule.selectors.evaluatorIds(runId))
 * ```
 *
 * @packageDocumentation
 */

// ============================================================================
// MOLECULE
// ============================================================================

export {
    evaluationRunMolecule,
    type EvaluationRunMolecule,
    type AnnotationColumnDef as EvaluationRunAnnotationColumnDef,
} from "./state/molecule"

// ============================================================================
// SCHEMAS & TYPES
// ============================================================================

export {
    // Enums
    evaluationRunStepTypeSchema,
    type EvaluationRunStepType,
    evaluationRunStepOriginSchema,
    type EvaluationRunStepOrigin,
    evaluationRunMappingKindSchema,
    type EvaluationRunMappingKind,
    // Sub-schemas
    evaluationRunDataStepSchema,
    type EvaluationRunDataStep,
    evaluationRunDataMappingSchema,
    type EvaluationRunDataMapping,
    evaluationRunDataSchema,
    type EvaluationRunData,
    evaluationRunFlagsSchema,
    type EvaluationRunFlags,
    // Entity
    evaluationRunSchema,
    type EvaluationRun,
    // Response
    evaluationRunResponseSchema,
    type EvaluationRunResponse,
    evaluationRunsResponseSchema,
    type EvaluationRunsResponse,
    // Evaluation Results (Scenario Steps)
    evaluationResultSchema,
    type EvaluationResult,
    evaluationResultsResponseSchema,
    type EvaluationResultsResponse,
    // Param types
    type EvaluationRunDetailParams,
    type EvaluationRunQueryParams,
    type EvaluationResultsQueryParams,
} from "./core"

// ============================================================================
// API
// ============================================================================

export {fetchEvaluationRun, queryEvaluationRuns, queryEvaluationResults} from "./api"

// ============================================================================
// STATE
// ============================================================================

export {
    evaluationRunQueryAtomFamily,
    scenarioStepsQueryAtomFamily,
    invalidateEvaluationRunCache,
} from "./state"
