/**
 * Annotation Entity Module
 *
 * Provides molecules and utilities for managing annotation entities.
 * Annotations are keyed by composite `traceId:spanId` strings.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { annotationMolecule, encodeAnnotationId } from '@agenta/entities/annotation'
 *
 * // Create composite key
 * const compositeId = encodeAnnotationId(traceId, spanId)
 *
 * // Reactive atoms (for useAtomValue)
 * const annotations = useAtomValue(annotationMolecule.selectors.data(compositeId))
 * const isDirty = useAtomValue(annotationMolecule.selectors.isDirty(compositeId))
 *
 * // Imperative API
 * const annotations = annotationMolecule.get.data(compositeId)
 *
 * // Cache invalidation
 * annotationMolecule.cache.invalidateByLink(traceId, spanId)
 * ```
 */

// ============================================================================
// MOLECULE (Primary API)
// ============================================================================

export {annotationMolecule, type AnnotationMolecule} from "./state/molecule"

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
    // Entity
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
} from "./core"

export type {
    AnnotationQueryLink,
    AnnotationQueryParams,
    AnnotationDetailParams,
    CreateAnnotationPayload,
    UpdateAnnotationPayload,
} from "./core"

// ============================================================================
// API FUNCTIONS
// ============================================================================

export {
    createAnnotation,
    fetchAnnotation,
    updateAnnotation,
    deleteAnnotation,
    queryAnnotations,
    queryAnnotationsByInvocationLink,
} from "./api"

// ============================================================================
// STATE ATOMS
// ============================================================================

export {
    // Query
    annotationQueryAtomFamily,
    // Draft
    annotationDraftAtomFamily,
    annotationIsDirtyAtomFamily,
    type AnnotationDraft,
    // Mutations
    updateAnnotationDraftAtom,
    discardAnnotationDraftAtom,
    // Cache invalidation
    invalidateAnnotationCache,
    invalidateAnnotationCacheByLink,
} from "./state"
