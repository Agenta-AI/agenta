/**
 * Annotation State
 *
 * Jotai atoms and molecule for annotation entity state management.
 */

// ============================================================================
// MOLECULE (Primary API)
// ============================================================================

export {annotationMolecule, type AnnotationMolecule} from "./molecule"

// ============================================================================
// STORE ATOMS
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
} from "./molecule"
