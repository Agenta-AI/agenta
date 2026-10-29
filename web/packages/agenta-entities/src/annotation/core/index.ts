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
    annotationKindSchema,
    annotationOriginSchema,
    // Sub-schemas
    annotationLinkSchema,
    annotationReferenceSchema,
    annotationReferencesSchema,
    annotationMetaSchema,
    annotationDataSchema,
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
