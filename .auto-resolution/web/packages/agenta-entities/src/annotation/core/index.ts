/**
 * Annotation Core Module
 *
 * Exports Zod schemas, TypeScript types, and composite key helpers.
 */

// ============================================================================
// SCHEMAS & TYPES
// ============================================================================

export {
    // Enums
    annotationChannelSchema,
    type AnnotationChannel,
    annotationKindSchema,
    type AnnotationKind,
    annotationOriginSchema,
    type AnnotationOrigin,
    // Sub-schemas
    annotationLinkSchema,
    type AnnotationLink,
    annotationReferenceSchema,
    type AnnotationReference,
    annotationReferencesSchema,
    type AnnotationReferences,
    annotationMetaSchema,
    type AnnotationMeta,
    annotationDataSchema,
    type AnnotationData,
    // Entity schema
    annotationSchema,
    type Annotation,
    // Response schemas
    annotationResponseSchema,
    type AnnotationResponse,
    annotationsResponseSchema,
    type AnnotationsResponse,
    // Composite key helpers
    encodeAnnotationId,
    decodeAnnotationId,
} from "./schema"

// ============================================================================
// API PARAMETER TYPES
// ============================================================================

export type {
    AnnotationQueryLink,
    AnnotationQueryParams,
    AnnotationDetailParams,
    CreateAnnotationPayload,
    UpdateAnnotationPayload,
} from "./types"
