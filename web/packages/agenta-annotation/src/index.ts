/**
 * @agenta/annotation
 *
 * State-only package for annotation session orchestration.
 * Contains the session controller, form controller, and types — no React UI.
 *
 * @packageDocumentation
 */

export {
    annotationSessionController,
    type AnnotationSessionController,
    type AddToTestsetExportJob,
    type AddToTestsetScope,
    registerAnnotationCallbacks,
    annotationFormController,
    type AnnotationFormController,
    getOutputsSchema,
    getMetricFieldsFromEvaluator,
    getMetricsFromAnnotation,
    isEmptyValue,
    OUTPUT_KEYS,
    getTraceInputDisplayKeys,
    getTraceInputDisplayValue,
} from "./state"

export type {
    OpenQueuePayload,
    AnnotationProgress,
    AnnotationSessionCallbacks,
    AnnotationColumnDef,
    ScenarioListColumnDef,
    AnnotationMetricField,
    AnnotationMetrics,
    ScenarioContext,
    UpdateMetricPayload,
    SubmitAnnotationsPayload,
    EvaluatorStepRef,
    EvaluatorResolutionState,
    SessionView,
    ScenarioEvaluatorKey,
    ScenarioMetricForEvaluator,
} from "./state"
