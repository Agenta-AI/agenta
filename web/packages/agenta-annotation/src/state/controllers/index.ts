export {
    annotationSessionController,
    type AnnotationSessionController,
    type AddToTestsetExportJob,
    type AddToTestsetScope,
    registerAnnotationCallbacks,
    OUTPUT_KEYS,
} from "./annotationSessionController"

export type {ScenarioMetricData} from "@agenta/evaluations/state"

// Schema-extraction helpers now live in `@agenta/evaluations/state`; re-export
// them from their original annotation path so existing importers keep resolving.
export {
    getOutputsSchema,
    getMetricFieldsFromEvaluator,
    getMetricsFromAnnotation,
} from "@agenta/evaluations/state"

export {
    annotationFormController,
    type AnnotationFormController,
    isEmptyValue,
} from "./annotationFormController"
