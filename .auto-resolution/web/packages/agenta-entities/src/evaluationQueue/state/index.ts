/**
 * EvaluationQueue State
 *
 * Jotai atoms and molecule for evaluation queue entity state management.
 */

// ============================================================================
// MOLECULE (Primary API)
// ============================================================================

export {evaluationQueueMolecule, type EvaluationQueueMolecule} from "./molecule"

// ============================================================================
// STORE ATOMS
// ============================================================================

export {
    // List query
    evaluationQueuesListQueryAtom,
    evaluationQueuesListDataAtom,
    // Single entity
    evaluationQueueQueryAtomFamily,
    evaluationQueueDraftAtomFamily,
    evaluationQueueEntityAtomFamily,
    evaluationQueueIsDirtyAtomFamily,
    // Mutations
    updateEvaluationQueueDraftAtom,
    discardEvaluationQueueDraftAtom,
    // Cache invalidation
    invalidateEvaluationQueuesListCache,
    invalidateEvaluationQueueCache,
} from "./molecule"
