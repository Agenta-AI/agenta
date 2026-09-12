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
// INSPECT META (per-harness capability map from `/inspect` meta)
// ============================================================================

export {
    harnessCapabilitiesAtomFamily,
    harnessCatalogFailedAtom,
    retryHarnessCatalogAtom,
    contextWindowForModel,
    modalitiesForModel,
    type HarnessCapabilities,
    type HarnessCapabilitiesMap,
    type ModelCatalogEntry,
    type ModelPricing,
    type ModelRatings,
} from "./inspectMeta"

// ============================================================================
// RUNNER SUBSCRIPTION STATUS (live per-harness login state)
// ============================================================================

export {
    subscriptionStatusKey,
    subscriptionStatusQueryAtomFamily,
    SUBSCRIPTION_STATUS_QUERY_HARNESS,
    resolveSubscriptionStatus,
    type SubscriptionStatusDisplay,
    type SubscriptionStatusTone,
} from "./subscriptionStatus"

export {
    agentModelCandidatesAtomFamily,
    loadAgentModelCandidates,
    resolveAgentModelCandidateSources,
    type AgentModelCandidatesState,
} from "./agentModelCandidates"

// ============================================================================
// HELPERS
// ============================================================================

export {
    agentFlagsQueryOptions,
    deriveWorkflowTypeFromRevision,
    ensureAgentFlags,
    selectAgentWorkflows,
    selectNonAgentWorkflows,
    withAgentFlags,
} from "./helpers"

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
    promptWorkflowsListQueryStateAtom,
    agentWorkflowsListQueryStateAtom,
    appWorkflowsAgentFlagsQueryAtom,
    appWorkflowsWithAgentFlagsAtom,
    // Single workflow artifact by id (current-workflow resolution without listing all)
    workflowDetailQueryAtomFamily,
    // Variant/Revision list queries (for 3-level hierarchy)
    workflowVariantsQueryAtomFamily,
    workflowVariantsListDataAtomFamily,
    workflowVariantsCachedListAtomFamily,
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
    workflowAgentTemplateOverlayAtomFamily,
    workflowBuildKitEnabledAtomFamily,
    workflowBuildKitDisabledOpsAtomFamily,
    type BuildKitUiState,
    workflowBuildKitOverlayReadyAtomFamily,
    type AgentTemplate,
    // Mutations
    updateWorkflowDraftAtom,
    registerWorkflowDraftCallbacks,
    clearWorkflowDraftCallbacks,
    type WorkflowDraftCallbacks,
    discardWorkflowDraftAtom,
    // Cache invalidation
    invalidateWorkflowsListCache,
    invalidateWorkflowCache,
    invalidateAgentCommittedRevisionCache,
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
    // Static catalog schema (agent-template etc.) — exported for early prefetch
    agTypeSchemaAtomFamily,
    // Artifact (workflow-level container — entity display name)
    workflowArtifactQueryAtomFamily,
    workflowArtifactScopedQueryAtomFamily,
    workflowVariantsScopedQueryAtomFamily,
    primeWorkflowArtifactCacheImperative,
} from "./store"

// Persisted agent-type map (cold-reload fallback for playgroundEarlyAgentStateAtom)
// ============================================================================
// AGENT ICON (per-agent glyph + colour, persisted client-side)
// ============================================================================

export {agentIconAtomFamily, type AgentIconRecord} from "./agentIcon"

export {readPersistedAgentType} from "./persistedAgentType"

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
    llmEvaluatorsAtom,
    fullPagePlaygroundEvaluatorsAtom,
    nonHumanEvaluatorsAtom,
    nonDeterministicEvaluatorsAtom,
    // Lazy enrichment gate (defers the per-evaluator latest-revision fan-out)
    evaluatorEnrichmentActivatedAtom,
    activateEvaluatorEnrichmentAtom,
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
    // Workflow display metadata (version count + last modified)
    evaluatorWorkflowMetaMapAtom,
    type EvaluatorWorkflowMeta,
    // Parent evaluator name lookup per revision
    evaluatorNameByRevisionAtomFamily,
    // Feedback metric schemas (observability annotation filter)
    evaluatorFeedbackSchemasAtom,
    type EvaluatorFeedbackSchema,
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

// ============================================================================
// AGENT CREATION PREFERENCES (last-used harness/model/connection default)
// ============================================================================

export {
    agentCreationPrefsAtom,
    applyAgentCreationPrefs,
    ensureEnabledSandbox,
    type AgentCreationPrefs,
} from "./agentCreationPrefs"

export {agentRosterSearchAtom, matchesAgentQuery} from "./agentRoster"
