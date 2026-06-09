/**
 * @agenta/evaluations — generic scenario-data module.
 *
 * Source-agnostic scenario-data, evaluator, and metrics selectors, relocated
 * faithfully from the annotation session controller and re-keyed PURELY by
 * `{projectId, runId, scenarioId}` (or `{projectId, runId}` / `{projectId,
 * testcaseId}`). It does NOT import from `@agenta/annotation`, reference any
 * queue concept, or read the session engine.
 */

import {
    scenarioMetricForEvaluatorAtomFamily,
    scenarioMetricsAtomFamily,
    scenarioMetricsQueryAtomFamily,
} from "./metrics"
import {
    evaluatorColumnDefsAtomFamily,
    evaluatorIdsAtomFamily,
    evaluatorRevisionIdsAtomFamily,
    evaluatorStepRefsAtomFamily,
    scenarioRootSpanAtomFamily,
    scenarioStepsQueryStateAtomFamily,
    scenarioTestcaseRefAtomFamily,
    scenarioTraceQueryAtomFamily,
    scenarioTraceRefAtomFamily,
    testcaseDataAtomFamily,
} from "./selectors"

// Key types
export type {RunKey, ScenarioKey, TestcaseKey} from "./selectors"
export type {ScenarioMetricsKey, ScenarioMetricForEvaluatorKey} from "./metrics"

// Helper functions (exported so annotation can reuse them)
export {resolveMetricValue, resolveMetricStats} from "./metrics"

// Selector families (also re-exported individually for direct use)
export {
    evaluatorColumnDefsAtomFamily,
    evaluatorIdsAtomFamily,
    evaluatorRevisionIdsAtomFamily,
    evaluatorStepRefsAtomFamily,
    scenarioRootSpanAtomFamily,
    scenarioStepsQueryStateAtomFamily,
    scenarioTestcaseRefAtomFamily,
    scenarioTraceQueryAtomFamily,
    scenarioTraceRefAtomFamily,
    testcaseDataAtomFamily,
} from "./selectors"
export {
    scenarioMetricForEvaluatorAtomFamily,
    scenarioMetricsAtomFamily,
    scenarioMetricsQueryAtomFamily,
} from "./metrics"

// Types
export type {
    EvaluatorColumnDef,
    EvaluatorStepRef,
    ScenarioEvaluatorKey,
    ScenarioMetricData,
    ScenarioMetricForEvaluator,
} from "./types"

/**
 * Generic scenario-data selectors object — mirrors the
 * `evaluationSessionController.selectors` access pattern.
 */
export const scenarioDataSelectors = {
    // Evaluator selectors — keyed by {projectId, runId}
    evaluatorIds: evaluatorIdsAtomFamily,
    evaluatorRevisionIds: evaluatorRevisionIdsAtomFamily,
    evaluatorStepRefs: evaluatorStepRefsAtomFamily,
    evaluatorColumnDefs: evaluatorColumnDefsAtomFamily,
    // Scenario-data selectors — keyed by {projectId, runId, scenarioId}
    scenarioSteps: scenarioStepsQueryStateAtomFamily,
    scenarioTraceRef: scenarioTraceRefAtomFamily,
    scenarioTestcaseRef: scenarioTestcaseRefAtomFamily,
    scenarioTraceQuery: scenarioTraceQueryAtomFamily,
    scenarioRootSpan: scenarioRootSpanAtomFamily,
    // Testcase data — keyed by {projectId, testcaseId}
    testcaseData: testcaseDataAtomFamily,
    // Metrics — keyed by {projectId, runId, scenarioId} (+ evaluator key)
    scenarioMetricsQuery: scenarioMetricsQueryAtomFamily,
    scenarioMetrics: scenarioMetricsAtomFamily,
    scenarioMetricForEvaluator: scenarioMetricForEvaluatorAtomFamily,
}

export type ScenarioDataSelectors = typeof scenarioDataSelectors
