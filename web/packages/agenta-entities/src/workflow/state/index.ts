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
// HELPERS
// ============================================================================

export {deriveWorkflowTypeFromRevision} from "./helpers"

// ============================================================================
// STORE ATOMS
// ============================================================================

export {
    // Project ID
    workflowProjectIdAtom,
    // App workflows list query (non-evaluator)
    appWorkflowsListQueryAtom,
    appWorkflowsListDataAtom,
    nonArchivedAppWorkflowsAtom,
    appWorkflowsListQueryStateAtom,
    // Variant/Revision list queries (for 3-level hierarchy)
    workflowVariantsQueryAtomFamily,
    workflowVariantsListDataAtomFamily,
    workflowRevisionsQueryAtomFamily,
    workflowRevisionRefsByVariantAtomFamily,
    workflowRevisionsListDataAtomFamily,
    // Revision by workflow (for 2-level hierarchy)
    workflowRevisionsByWorkflowQueryAtomFamily,
    workflowRevisionsByWorkflowListDataAtomFamily,
    type WorkflowRevisionRef,
    type WorkflowListRef,
    // Single entity
    workflowQueryAtomFamily,
    workflowDraftAtomFamily,
    workflowBaseEntityAtomFamily,
    workflowEntityAtomFamily,
    workflowIsDirtyAtomFamily,
    workflowIsEphemeralAtomFamily,
    // Mutations
    updateWorkflowDraftAtom,
    discardWorkflowDraftAtom,
    // Cache invalidation
    invalidateWorkflowsListCache,
    invalidateWorkflowCache,
    seedCreatedWorkflowCache,
    // ListQueryState wrappers (for selection adapters and relations)
    workflowVariantsListQueryStateAtomFamily,
    workflowRevisionsListQueryStateAtomFamily,
    // Local drafts
    workflowLocalServerDataAtomFamily,
    workflowServerDataSelectorFamily,
    createLocalDraftFromWorkflowRevision,
    // Ephemeral workflows (from trace data)
    createEphemeralWorkflow,
    type CreateEphemeralWorkflowParams,
    // Cross-context ephemeral cleanup (drawer-create flows)
    discardLocalServerDataAtom,
    // Latest revision (derived from already-fetched data)
    workflowLatestRevisionIdAtomFamily,
    workflowAppTypeAtomFamily,
    workflowLatestRevisionQueryAtomFamily,
} from "./store"

// Union atoms (app + evaluator combined)
export {
    workflowsListDataAtom,
    nonArchivedWorkflowsAtom,
    workflowsListQueryStateAtom,
} from "./allWorkflows"

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
    // Schema selectors
    appRoutePathAtomFamily,
    appOpenApiSchemaAtomFamily,
    // Helpers
    resolveBuiltinAppServiceUrl,
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
    getWorkflowCommitCallbacks,
    clearWorkflowCommitCallbacks,
    invokeWorkflowCommitCallbacks,
    // Create Variant
    createWorkflowVariantAtom,
    type WorkflowCreateVariantParams,
    type WorkflowCreateVariantResult,
    type WorkflowCreateVariantOutcome,
    // Create from Ephemeral
    createWorkflowFromEphemeralAtom,
    type WorkflowCreateFromEphemeralParams,
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

// ============================================================================
// EVALUATOR UTILITIES (for evaluator-type workflows)
// ============================================================================

export {
    // Evaluator-filtered list queries
    evaluatorsListQueryAtom,
    evaluatorsListDataAtom,
    nonArchivedEvaluatorsAtom,
    // Templates
    evaluatorTemplatesQueryAtom,
    evaluatorTemplatesDataAtom,
    evaluatorTemplatesMapAtom,
    // Template lookup
    evaluatorTemplateByKeyAtomFamily,
    // Catalog presets
    evaluatorCatalogPresetsQueryAtomFamily,
    evaluatorPresetsAtomFamily,
    // Key map
    evaluatorKeyMapAtom,
    // Evaluator configs (non-human, non-custom)
    evaluatorConfigsListDataAtom,
    evaluatorConfigsQueryStateAtom,
    evaluatorConfigRevisionsListDataAtom,
    evaluatorConfigRevisionsQueryStateAtom,
    // Human evaluators
    humanEvaluatorsListQueryAtom,
    humanEvaluatorsListDataAtom,
    // Cache invalidation
    invalidateEvaluatorsListCache,
    onEvaluatorMutation,
    // Create from template
    createEvaluatorFromTemplate,
    // Human evaluator CRUD
    createHumanEvaluatorAtom,
    updateHumanEvaluatorAtom,
    buildHumanEvaluatorOutputsSchema,
    type CreateHumanEvaluatorParams,
    type UpdateHumanEvaluatorParams,
    type HumanEvaluatorMetric,
    // Selection config
    evaluatorSelectionConfig,
    type EvaluatorSelectionConfig,
} from "./evaluatorUtils"

// ============================================================================
// APP UTILITIES (for application-type workflows)
// ============================================================================

export {
    // Templates
    appTemplatesQueryAtom,
    appTemplatesDataAtom,
    // Create ephemeral app from template (entity lifecycle)
    createEphemeralAppFromTemplate,
    type AppType,
    type CreateEphemeralAppFromTemplateParams,
} from "./appUtils"
