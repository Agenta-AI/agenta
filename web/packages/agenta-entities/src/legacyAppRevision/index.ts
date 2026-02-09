/**
 * LegacyAppRevision Entity Module
 *
 * Complete OSS app revision entity management with:
 * - Zod schemas for validation
 * - Data transformers for legacy API
 * - Jotai state management (molecule pattern)
 * - Runnable capability support
 *
 * This module uses the legacy backend API (AppVariantRevision model):
 * - GET /variants/{variant_id}/revisions/{revision_number}/
 * - POST /variants/revisions/query/
 *
 * @example
 * ```typescript
 * import { legacyAppRevisionMolecule, type LegacyAppRevisionData } from '@agenta/entities/legacyAppRevision'
 *
 * // Reactive atoms (for useAtomValue, atom compositions)
 * const data = useAtomValue(legacyAppRevisionMolecule.atoms.data(revisionId))
 * const isDirty = useAtomValue(legacyAppRevisionMolecule.atoms.isDirty(revisionId))
 * const schema = useAtomValue(legacyAppRevisionMolecule.atoms.agConfigSchema(revisionId))
 *
 * // Runnable capability atoms
 * const inputPorts = useAtomValue(legacyAppRevisionMolecule.selectors.inputPorts(revisionId))
 * const outputPorts = useAtomValue(legacyAppRevisionMolecule.selectors.outputPorts(revisionId))
 *
 * // Write atoms (for use in other atoms with set())
 * set(legacyAppRevisionMolecule.actions.update, revisionId, { parameters: newParams })
 * set(legacyAppRevisionMolecule.actions.discard, revisionId)
 *
 * // Imperative API (for callbacks outside React/atom context)
 * const data = legacyAppRevisionMolecule.get.data(revisionId)
 * legacyAppRevisionMolecule.set.update(revisionId, { parameters: newParams })
 * ```
 */

// ============================================================================
// CORE - Schemas and Types
// ============================================================================

export {
    // Zod schemas
    executionModeSchema,
    configDBSchema,
    apiAppVariantRevisionSchema,
    legacyAppRevisionDataSchema,
    // Parse utilities
    parseLegacyAppRevision,
    createEmptyLegacyAppRevision,
    createEmptySchemaState,
} from "./core"

export type {
    // Execution mode
    ExecutionMode,
    // Backend types
    ConfigDB,
    ApiAppVariantRevision,
    // Data types
    LegacyAppRevisionData,
    EndpointSchema,
    RevisionSchemaState,
    // Selection types
    LegacyAppRevisionSelectionResult,
    // API params
    LegacyAppRevisionDetailParams,
    LegacyAppRevisionBatchParams,
    LegacyAppRevisionListParams,
    // Re-exports
    EntitySchema,
    EntitySchemaProperty,
} from "./core"

// ============================================================================
// FACTORY - Local Draft Creation
// ============================================================================

export {
    createLocalLegacyAppRevision,
    cloneAsLocalDraft,
    type CreateLocalLegacyAppRevisionParams,
    type LocalLegacyAppRevision,
} from "./core/factory"

// ============================================================================
// RELATIONS - Entity Hierarchy Definitions
// ============================================================================

export {
    // Relations
    ossAppToVariantRelation,
    ossVariantToRevisionRelation,
    // Registration function
    registerLegacyAppRevisionRelations,
    // Root-level atom
    ossAppsListAtom,
    // Types
    type OssAppRootEntity,
} from "./relations"

// ============================================================================
// API - HTTP Functions and Transformers
// ============================================================================

export {
    // Data transformers
    transformApiRevision,
    transformEnhancedVariant,
    // Fetch functions
    fetchOssRevision,
    fetchOssRevisionById,
    fetchOssRevisionsBatch,
    fetchOssRevisionEnriched,
    fetchVariantDetail,
    // URI utilities
    normalizeUri,
    // List API functions
    fetchAppsList,
    fetchVariantsList,
    fetchRevisionsList,
    // Schema functions
    fetchRevisionSchema,
    buildRevisionSchemaState,
    extractEndpointSchema,
    extractAllEndpointSchemas,
    constructEndpointPath,
    // Validation
    isValidUUID,
    // Types
    type TransformContext,
    type RevisionsQueryRequest,
    type RevisionsQueryResponse,
    type VariantListItem,
    type RevisionListItem,
    type AppListItem,
    type ApiVariant,
    type ApiApp,
    type ApiRevisionListItem,
    type ApiVariantDetail,
    type VariantDetail,
    type OpenAPISpec,
} from "./api"

// ============================================================================
// STATE - Molecule and Store Atoms
// ============================================================================

export {
    legacyAppRevisionMolecule,
    legacyAppRevisionSelectionConfig,
    // Controller hook and types
    useLegacyAppRevisionController,
    type LegacyAppRevisionControllerState,
    type LegacyAppRevisionControllerDispatch,
    type LegacyAppRevisionControllerResult,
    type LegacyAppRevisionMolecule,
    type LegacyAppRevisionSelectionConfig,
} from "./state"

// ============================================================================
// SNAPSHOT - Draft Patch Helpers for URL Sharing
// ============================================================================

export {
    buildLegacyAppRevisionDraftPatch,
    applyLegacyAppRevisionDraftPatch,
    initializeServerData,
    hasDraftChanges,
    type LegacyAppRevisionDraftPatch,
    type BuildPatchResult,
} from "./snapshot"

// Auto-register snapshot adapter when this module is imported
// This ensures the adapter is available in the registry for snapshot operations
import "./snapshotAdapter"
export {legacyAppRevisionSnapshotAdapter} from "./snapshotAdapter"

// Re-export store atoms for direct access if needed
export {
    // Query atoms
    legacyAppRevisionQueryAtomFamily,
    legacyAppRevisionDraftAtomFamily,
    legacyAppRevisionEntityAtomFamily,
    legacyAppRevisionIsDirtyAtomFamily,
    legacyAppRevisionInputPortsAtomFamily,
    type LegacyAppRevisionInputPort,
    // Enriched query atoms (with URI from variant)
    enrichedQueryAtomFamily,
    variantDetailCacheAtomFamily,
    legacyAppRevisionEnrichedDataFamily,
    createEnrichedKey,
    type EnrichedQueryKey,
    // Entity atoms with enrichment support
    legacyAppRevisionEntityWithBridgeAtomFamily,
    legacyAppRevisionServerDataSelectorFamily,
    legacyAppRevisionIsDirtyWithBridgeAtomFamily,
    // Legacy atoms (deprecated - use enriched query pattern)
    legacyAppRevisionServerDataAtomFamily,
    // List atoms
    appsListAtom,
    variantsListAtomFamily,
    variantsListQueryStateAtomFamily,
    revisionsListAtomFamily,
    revisionsListQueryStateAtomFamily,
    appsQueryAtom,
    variantsQueryAtomFamily,
    revisionsQueryAtomFamily,
    // List atoms with local drafts
    LOCAL_DRAFTS_VARIANT_ID,
    variantsListWithDraftsAtomFamily,
    revisionsListWithDraftsAtomFamily,
    type VariantListItemWithDrafts,
    type RevisionListItemWithDrafts,
    // Mutations
    updateLegacyAppRevisionAtom,
    discardLegacyAppRevisionDraftAtom,
    // Server data management
    setServerDataAtom,
    clearServerDataAtom,
    // Enhanced prompts/custom properties
    setEnhancedPromptsAtom,
    mutateEnhancedPromptsAtom,
    setEnhancedCustomPropertiesAtom,
    mutateEnhancedCustomPropertiesAtom,
    updatePropertyAtom,
    // Override functions
    setAppsListAtom,
    setVariantsListAtomFamily,
    setRevisionsListAtomFamily,
    // Cache reactivity
    revisionCacheVersionAtom,
} from "./state"

// Re-export schema atoms
export {
    legacyAppRevisionSchemaQueryAtomFamily,
    revisionOpenApiSchemaAtomFamily,
    revisionAgConfigSchemaAtomFamily,
    revisionPromptSchemaAtomFamily,
    revisionCustomPropertiesSchemaAtomFamily,
    revisionSchemaAtPathAtomFamily,
    revisionEndpointsAtomFamily,
    getSchemaPropertyAtPath,
    // Enhanced custom properties (with values)
    revisionEnhancedCustomPropertiesAtomFamily,
    revisionCustomPropertyKeysAtomFamily,
    type EnhancedCustomProperty,
    // Enhanced prompts (with values)
    revisionEnhancedPromptsAtomFamily,
    revisionPromptKeysAtomFamily,
    type EnhancedPrompt,
    // Service schema metadata warmer
    serviceSchemaMetadataWarmerAtom,
} from "./state"

// Re-export spec derivation utilities (pure functions)
export {
    deriveEnhancedPrompts,
    deriveEnhancedCustomProperties,
    isPromptLikeStructure,
    isPromptLikeSchema,
    isPromptProperty,
    enhanceToolsArray,
} from "./utils"

// Re-export metadata atoms
export {
    // Atoms
    metadataAtom,
    metadataSelectorFamily,
    // Utilities
    updateMetadataAtom,
    getMetadataLazy,
    getAllMetadata,
    hashMetadata,
    hashAndStoreMetadata,
    // Types
    type ConfigMetadata,
    type BaseMetadata,
    type StringMetadata,
    type NumberMetadata,
    type BooleanMetadata,
    type ArrayMetadata,
    type ObjectMetadata,
} from "./state/metadataAtoms"

// Re-export runnable extension
export {
    runnableAtoms,
    runnableReducers,
    runnableGet,
    runnableSet,
    legacyAppRevisionRunnableExtension,
    type LegacyAppRevisionOutputPort,
} from "./state"

// ============================================================================
// COMMIT
// ============================================================================

export {
    // Commit atom and function
    commitRevisionAtom,
    commitRevision,
    // Callback registration
    registerCommitCallbacks,
    clearCommitCallbacks,
    // Utilities
    newestRevisionForVariantAtomFamily,
    // Types
    type CommitRevisionParams,
    type CommitRevisionResult,
    type CommitRevisionError,
    type CommitResult,
    type CommitCallbacks,
} from "./state"

// ============================================================================
// LOCAL DRAFTS - Entity-level local draft management
// ============================================================================

export {
    // Atoms
    localDraftIdsAtom,
    localDraftsListAtom,
    hasLocalDraftsAtom,
    hasUnsavedLocalDraftsAtom,
    // Write atoms
    createLocalDraftAtom,
    discardLocalDraftAtom,
    discardAllLocalDraftsAtom,
    // Imperative functions
    createLocalDraftFromRevision,
    discardLocalDraft,
    discardAllLocalDrafts,
    cleanupStaleLocalDrafts,
    // App scoping setup
    setCurrentAppIdAtom,
    // Re-exports
    isLocalDraftId,
    extractSourceIdFromDraft,
    // Types
    type LocalDraftEntry,
} from "./state"
