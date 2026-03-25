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
    registerAnnotationCallbacks,
    annotationFormController,
    type AnnotationFormController,
    getOutputsSchema,
    getMetricFieldsFromEvaluator,
    getMetricsFromAnnotation,
    isEmptyValue,
    OUTPUT_KEYS,
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
    SessionView,
    ScenarioEvaluatorKey,
    ScenarioMetricForEvaluator,
} from "./state"
