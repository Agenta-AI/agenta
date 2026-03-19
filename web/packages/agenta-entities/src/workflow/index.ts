/**
 * Workflow Entity Module
 *
 * Provides molecules and utilities for managing Workflow entities.
 * Unlike evaluators which hardcode `is_evaluator: true`, workflows
 * accept optional flags for flexible querying and creation.
 *
 * ## Overview
 *
 * This module exports:
 * - **Molecule** - Unified state management for workflow entities
 * - **Schemas** - Zod schemas for validation
 * - **API functions** - HTTP functions for CRUD operations
 * - **Types** - TypeScript interfaces (including flag types)
 * - **Runnable extension** - Atoms for playground integration
 *
 * ## Quick Start
 *
 * ```typescript
 * import { workflowMolecule } from '@agenta/entities/workflow'
 *
 * // Reactive atoms (for useAtomValue, atom compositions)
 * const data = useAtomValue(workflowMolecule.selectors.data(workflowId))
 * const isDirty = useAtomValue(workflowMolecule.selectors.isDirty(workflowId))
 * const isChat = useAtomValue(workflowMolecule.selectors.isChat(workflowId))
 * const flags = useAtomValue(workflowMolecule.selectors.flags(workflowId))
 *
 * // Write atoms (for use in other atoms with set())
 * set(workflowMolecule.actions.update, workflowId, { data: { parameters: newParams } })
 * set(workflowMolecule.actions.discard, workflowId)
 *
 * // Imperative API (for callbacks outside React/atom context)
 * const data = workflowMolecule.get.data(workflowId)
 * workflowMolecule.set.update(workflowId, { data: { parameters: newParams } })
 * ```
 */

// Side-effect: register snapshot adapter with the registry
import "./snapshotAdapter"

// ============================================================================
// MOLECULE (Primary API)
// ============================================================================

export {workflowMolecule, type WorkflowMolecule} from "./state/molecule"

// ============================================================================
// SCHEMAS & TYPES
// ============================================================================

export {
    // Sub-schemas
    jsonSchemasSchema,
    type JsonSchemas,
    workflowFlagsSchema,
    type WorkflowFlags,
    workflowDataSchema,
    type WorkflowData,
    // Workflow
    workflowSchema,
    workflowSchemas,
    type Workflow,
    type CreateWorkflow,
    type UpdateWorkflow,
    type LocalWorkflow,
    // Variant schema (for 3-level hierarchy)
    workflowVariantSchema,
    type WorkflowVariant,
    workflowVariantsResponseSchema,
    type WorkflowVariantsResponse,
    // Response schemas
    workflowResponseSchema,
    type WorkflowResponse,
    workflowsResponseSchema,
    type WorkflowsResponse,
    workflowRevisionResponseSchema,
    type WorkflowRevisionResponse,
    workflowRevisionsResponseSchema,
    type WorkflowRevisionsResponse,
    // URI utilities
    parseWorkflowKeyFromUri,
    buildWorkflowUri,
    generateSlug,
    // Evaluator-specific utilities (for evaluator-type workflows)
    getEvaluatorColor,
    type EvaluatorColor,
    parseEvaluatorKeyFromUri,
    buildEvaluatorUri,
    // Output schema utilities
    resolveOutputSchemaProperties,
} from "./core"

// Flag query type
export type {WorkflowQueryFlags} from "./core"

export type {
    // API parameter types
    WorkflowListParams,
    WorkflowDetailParams,
    WorkflowReference,
    QueryResult,
} from "./core"

// ============================================================================
// EVALUATOR RESOLUTION
// ============================================================================

export {
    extractEvaluatorRef,
    deduplicateRefs,
    extractMetrics,
    toEvaluatorDefinitionFromWorkflow,
    toEvaluatorDefinitionFromRaw,
    type EvaluatorRef,
    type EvaluatorDefinition,
    type MetricColumnDefinition,
} from "./core"

// ============================================================================
// API FUNCTIONS
// ============================================================================

export {
    // Query / List
    queryWorkflows,
    // Query / List (Variants)
    queryWorkflowVariants,
    // Query / List (Revisions)
    queryWorkflowRevisionsByWorkflow,
    queryWorkflowRevisionsByWorkflows,
    queryWorkflowRevisions,
    // Fetch (single revision by ID)
    fetchWorkflowRevisionById,
    // Inspect (resolve full schema)
    inspectWorkflow,
    type InspectWorkflowResponse,
    // Fetch (latest revision by workflow ID)
    fetchWorkflow,
    // Create
    createWorkflow,
    type CreateWorkflowPayload,
    // Create from template (legacy endpoint orchestration)
    createAppFromTemplate,
    AppServiceType,
    type CreateAppFromTemplateParams,
    type CreateAppFromTemplateResult,
    // Update
    updateWorkflow,
    type UpdateWorkflowPayload,
    // Archive / Unarchive
    archiveWorkflow,
    archiveWorkflowVariant,
    unarchiveWorkflow,
    // Batch
    fetchWorkflowsBatch,
} from "./api"

// ============================================================================
// STATE ATOMS
// ============================================================================

export {
    // Project ID
    workflowProjectIdAtom,
    // App workflows list query (non-evaluator)
    appWorkflowsListQueryAtom,
    appWorkflowsListDataAtom,
    nonArchivedAppWorkflowsAtom,
    appWorkflowsListQueryStateAtom,
    // Union atoms (app + evaluator combined)
    workflowsListDataAtom,
    nonArchivedWorkflowsAtom,
    workflowsListQueryStateAtom,
    // Variant/Revision list queries
    workflowVariantsQueryAtomFamily,
    workflowVariantsListDataAtomFamily,
    workflowRevisionsQueryAtomFamily,
    workflowRevisionsListDataAtomFamily,
    // Revision by workflow
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
    // Local drafts
    workflowLocalServerDataAtomFamily,
    workflowServerDataSelectorFamily,
    createLocalDraftFromWorkflowRevision,
    // Ephemeral workflows (from trace data)
    createEphemeralWorkflow,
    type CreateEphemeralWorkflowParams,
    // Latest revision (derived from already-fetched data)
    workflowLatestRevisionIdAtomFamily,
    workflowLatestRevisionQueryAtomFamily,
    // Commit / Archive
    commitWorkflowRevisionAtom,
    commitWorkflowRevision,
    type WorkflowCommitParams,
    type WorkflowCommitResult,
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
    archiveWorkflowRevisionAtom,
    type WorkflowArchiveParams,
    type WorkflowArchiveResult,
    type WorkflowArchiveOutcome,
    type WorkflowArchiveCallbacks,
    registerWorkflowArchiveCallbacks,
    clearWorkflowArchiveCallbacks,
} from "./state"

// ============================================================================
// SELECTION CONFIG
// ============================================================================

export {
    workflowSelectionConfig,
    type WorkflowSelectionConfig,
    workflowRevisionSelectionConfig,
    type WorkflowRevisionSelectionConfig,
} from "./state"

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
    // Key map
    evaluatorKeyMapAtom,
    // Evaluator configs (non-human, non-custom)
    evaluatorConfigsListDataAtom,
    evaluatorConfigsQueryStateAtom,
    // Human evaluators
    humanEvaluatorsListDataAtom,
    // Cache invalidation
    invalidateEvaluatorsListCache,
    // Create from template (entity lifecycle)
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
} from "./state"

// ============================================================================
// TEMPLATES API
// ============================================================================

export {
    fetchEvaluatorTemplates,
    type EvaluatorTemplate,
    type EvaluatorTemplatesResponse,
} from "./api"

// ============================================================================
// RELATIONS
// ============================================================================

export {
    workflowToRevisionRelation,
    workflowToVariantRelation,
    workflowVariantToRevisionRelation,
    workflowsListAtom,
    registerWorkflowRelations,
} from "./relations"

// ============================================================================
// RUNNABLE EXTENSION
// ============================================================================

export {
    workflowRunnableExtension,
    runnableAtoms,
    runnableGet,
    // Schema selectors
    appRoutePathAtomFamily,
    appOpenApiSchemaAtomFamily,
    // Request payload
    requestPayloadAtomFamily,
    // Helpers
    resolveBuiltinAppServiceUrl,
} from "./state"

// ============================================================================
// SNAPSHOT ADAPTER
// ============================================================================

export {workflowSnapshotAdapter} from "./snapshotAdapter"
