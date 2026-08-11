/**
 * DTO-shaped annotation module.
 *
 * Kept on its own subpath rather than folded into `@agenta/entities/annotation`:
 * five exports there (`createAnnotation`, `fetchAnnotation`, `updateAnnotation`,
 * `deleteAnnotation`, `AnnotationsResponse`) already name the zod-validated
 * entity API, and these DTO-shaped equivalents are a different contract.
 */

export type {
    AnnotationDto,
    AnnotationResponseDto,
    AnnotationEditPayloadDto,
    AnnotationsResponseDto,
    AnnotationLinkDto,
    AnnotationReferenceDto,
    AnnotationReferencesDto,
    AnnotationMetadataDto,
    FullJson,
    FullJsonRec,
} from "./types"

export {
    spanUuidFromAnnotation,
    groupOutputValues,
    groupAnnotationsByReferenceId,
    attachAnnotationsToTraces,
    type GroupedOutputs,
    type AnnotationMetricValue,
    type AggregatedAnnotationMetric,
    type AggregatedEvaluatorMetrics,
    type AnnotationAttachments,
} from "./helpers"

export {transformApiData, type TransformableApiRecord} from "./transformer"

export {queryAllAnnotations} from "./api"
