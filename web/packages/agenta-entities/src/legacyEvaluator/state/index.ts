/**
 * LegacyEvaluator State
 *
 * Jotai atoms and molecule for LegacyEvaluator entity state management.
 */

// ============================================================================
// MOLECULE (Primary API)
// ============================================================================

export {legacyEvaluatorMolecule, type LegacyEvaluatorMolecule} from "./molecule"

// ============================================================================
// STORE ATOMS
// ============================================================================

export {
    // Project ID
    legacyEvaluatorProjectIdAtom,
    // List query
    legacyEvaluatorsListQueryAtom,
    legacyEvaluatorsListDataAtom,
    nonArchivedLegacyEvaluatorsAtom,
    // Single entity
    legacyEvaluatorQueryAtomFamily,
    legacyEvaluatorDraftAtomFamily,
    legacyEvaluatorEntityAtomFamily,
    legacyEvaluatorIsDirtyAtomFamily,
    // Mutations
    updateLegacyEvaluatorDraftAtom,
    discardLegacyEvaluatorDraftAtom,
    // Cache invalidation
    invalidateLegacyEvaluatorsListCache,
    invalidateLegacyEvaluatorCache,
} from "./store"

// ============================================================================
// SELECTION CONFIG
// ============================================================================

export {
    legacyEvaluatorSelectionConfig,
    type LegacyEvaluatorSelectionConfig,
} from "./selectionConfig"

// ============================================================================
// RUNNABLE EXTENSION
// ============================================================================

export {
    legacyEvaluatorRunnableExtension,
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
