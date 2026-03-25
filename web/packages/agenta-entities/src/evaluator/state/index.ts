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
    evaluatorRevisionQueryAtomFamily,
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
// TEMPLATES & KEY MAP
// ============================================================================

export {
    evaluatorTemplatesQueryAtom,
    evaluatorTemplatesDataAtom,
    evaluatorTemplatesMapAtom,
    evaluatorKeyMapAtom,
} from "./templates"

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
