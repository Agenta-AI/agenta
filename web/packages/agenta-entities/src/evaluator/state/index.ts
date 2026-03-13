/**
 * Evaluator State
 *
 * Jotai atoms and molecule for evaluator entity state management.
 */

// ============================================================================
// MOLECULE (Primary API)
// ============================================================================

export {evaluatorMolecule, type EvaluatorMolecule} from "./molecule"

// ============================================================================
// STORE ATOMS
// ============================================================================

export {
    // Project ID
    evaluatorProjectIdAtom,
    // List query
    evaluatorsListQueryAtom,
    evaluatorsListDataAtom,
    nonArchivedEvaluatorsAtom,
    // Variant/Revision list queries (for 3-level hierarchy)
    evaluatorVariantsQueryAtomFamily,
    evaluatorVariantsListDataAtomFamily,
    evaluatorRevisionsQueryAtomFamily,
    evaluatorRevisionsListDataAtomFamily,
    // Single entity
    evaluatorQueryAtomFamily,
    evaluatorDraftAtomFamily,
    evaluatorEntityAtomFamily,
    evaluatorIsDirtyAtomFamily,
    // Mutations
    updateEvaluatorDraftAtom,
    discardEvaluatorDraftAtom,
    // Cache invalidation
    invalidateEvaluatorsListCache,
    invalidateEvaluatorCache,
    // Enrichment maps
    evaluatorKeyMapAtom,
    evaluatorTemplatesMapAtom,
} from "./store"

// ============================================================================
// SELECTION CONFIG
// ============================================================================

/**
 * Pre-built selection config for the entity selection system.
 *
 * Provides the evaluators list atom for the 1-level evaluator adapter.
 *
 * @example
 * ```typescript
 * import { evaluatorSelectionConfig } from '@agenta/entities/evaluator'
 *
 * initializeSelectionSystem({
 *   evaluator: evaluatorSelectionConfig,
 * })
 * ```
 */
export {
    evaluatorSelectionConfig,
    type EvaluatorSelectionConfig,
    evaluatorRevisionSelectionConfig,
    type EvaluatorRevisionSelectionConfig,
} from "./selectionConfig"

// ============================================================================
// RUNNABLE EXTENSION
// ============================================================================

export {
    evaluatorRunnableExtension,
    runnableAtoms,
    runnableGet,
    // Individual atoms
    executionModeAtomFamily,
    invocationUrlAtomFamily,
    inputSchemaAtomFamily,
    outputSchemaAtomFamily,
    parametersSchemaAtomFamily,
    configurationAtomFamily,
    evaluatorUriAtomFamily,
    requestPayloadAtomFamily,
} from "./runnableSetup"
