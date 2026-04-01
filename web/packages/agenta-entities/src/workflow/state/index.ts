/**
 * Workflow State
 *
 * Jotai atoms and molecule for workflow entity state management.
 */

// ============================================================================
// MOLECULE (Primary API)
// ============================================================================

export {workflowMolecule, type WorkflowMolecule} from "./molecule"

// ============================================================================
// STORE ATOMS
// ============================================================================

export {
    // Project ID
    workflowProjectIdAtom,
    // List query
    workflowsListQueryAtom,
    workflowsListDataAtom,
    nonArchivedWorkflowsAtom,
    // Variant/Revision list queries (for 3-level hierarchy)
    workflowVariantsQueryAtomFamily,
    workflowVariantsListDataAtomFamily,
    workflowRevisionsQueryAtomFamily,
    workflowRevisionsListDataAtomFamily,
    // Revision by workflow (for 2-level hierarchy)
    workflowRevisionsByWorkflowQueryAtomFamily,
    workflowRevisionsByWorkflowListDataAtomFamily,
    // Single entity
    workflowQueryAtomFamily,
    workflowDraftAtomFamily,
    workflowEntityAtomFamily,
    workflowIsDirtyAtomFamily,
    // Mutations
    updateWorkflowDraftAtom,
    discardWorkflowDraftAtom,
    // Cache invalidation
    invalidateWorkflowsListCache,
    invalidateWorkflowCache,
    // ListQueryState wrappers (for selection adapters and relations)
    workflowVariantsListQueryStateAtomFamily,
    workflowRevisionsListQueryStateAtomFamily,
    workflowsListQueryStateAtom,
    // Local drafts
    workflowLocalServerDataAtomFamily,
    workflowServerDataSelectorFamily,
    createLocalDraftFromWorkflowRevision,
    // Latest revision (derived from already-fetched data)
    workflowLatestRevisionIdAtomFamily,
} from "./store"

// ============================================================================
// SELECTION CONFIG
// ============================================================================

export {
    workflowSelectionConfig,
    type WorkflowSelectionConfig,
    workflowRevisionSelectionConfig,
    type WorkflowRevisionSelectionConfig,
} from "./selectionConfig"

// ============================================================================
// RUNNABLE EXTENSION
// ============================================================================

export {
    workflowRunnableExtension,
    runnableAtoms,
    runnableGet,
    // Individual atoms
    executionModeAtomFamily,
    invocationUrlAtomFamily,
    inputSchemaAtomFamily,
    outputSchemaAtomFamily,
    parametersSchemaAtomFamily,
    configurationAtomFamily,
    workflowUriAtomFamily,
    requestPayloadAtomFamily,
} from "./runnableSetup"

// ============================================================================
// COMMIT / ARCHIVE
// ============================================================================

export {
    // Commit
    commitWorkflowRevisionAtom,
    commitWorkflowRevision,
    type WorkflowCommitParams,
    type WorkflowCommitResult,
    type WorkflowCommitError,
    type WorkflowCommitOutcome,
    type WorkflowCommitCallbacks,
    registerWorkflowCommitCallbacks,
    clearWorkflowCommitCallbacks,
    // Create Variant
    createWorkflowVariantAtom,
    type WorkflowCreateVariantParams,
    type WorkflowCreateVariantResult,
    type WorkflowCreateVariantOutcome,
    // Archive
    archiveWorkflowRevisionAtom,
    type WorkflowArchiveParams,
    type WorkflowArchiveResult,
    type WorkflowArchiveError,
    type WorkflowArchiveOutcome,
    type WorkflowArchiveCallbacks,
    registerWorkflowArchiveCallbacks,
    clearWorkflowArchiveCallbacks,
} from "./commit"
