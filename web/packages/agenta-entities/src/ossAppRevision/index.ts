/**
 * OssAppRevision Entity Module
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
 * import { ossAppRevisionMolecule, type OssAppRevisionData } from '@agenta/entities/ossAppRevision'
 *
 * // Reactive atoms (for useAtomValue, atom compositions)
 * const data = useAtomValue(ossAppRevisionMolecule.atoms.data(revisionId))
 * const isDirty = useAtomValue(ossAppRevisionMolecule.atoms.isDirty(revisionId))
 * const schema = useAtomValue(ossAppRevisionMolecule.atoms.agConfigSchema(revisionId))
 *
 * // Runnable capability atoms
 * const inputPorts = useAtomValue(ossAppRevisionMolecule.selectors.inputPorts(revisionId))
 * const outputPorts = useAtomValue(ossAppRevisionMolecule.selectors.outputPorts(revisionId))
 *
 * // Write atoms (for use in other atoms with set())
 * set(ossAppRevisionMolecule.actions.update, revisionId, { parameters: newParams })
 * set(ossAppRevisionMolecule.actions.discard, revisionId)
 *
 * // Imperative API (for callbacks outside React/atom context)
 * const data = ossAppRevisionMolecule.get.data(revisionId)
 * ossAppRevisionMolecule.set.update(revisionId, { parameters: newParams })
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
    ossAppRevisionDataSchema,
    // Parse utilities
    parseOssAppRevision,
    createEmptyOssAppRevision,
    createEmptySchemaState,
} from "./core"

export type {
    // Execution mode
    ExecutionMode,
    // Backend types
    ConfigDB,
    ApiAppVariantRevision,
    // Data types
    OssAppRevisionData,
    EndpointSchema,
    RevisionSchemaState,
    // Selection types
    OssAppRevisionSelectionResult,
    // API params
    OssAppRevisionDetailParams,
    OssAppRevisionBatchParams,
    OssAppRevisionListParams,
    // Re-exports
    EntitySchema,
    EntitySchemaProperty,
} from "./core"

// ============================================================================
// FACTORY - Local Draft Creation
// ============================================================================

export {
    createLocalOssAppRevision,
    cloneAsLocalDraft,
    type CreateLocalOssAppRevisionParams,
    type LocalOssAppRevision,
} from "./core/factory"

// ============================================================================
// RELATIONS - Entity Hierarchy Definitions
// ============================================================================

export {
    // Relations
    ossAppToVariantRelation,
    ossVariantToRevisionRelation,
    // Registration function
    registerOssAppRevisionRelations,
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
    ossAppRevisionMolecule,
    ossAppRevisionSelectionConfig,
    // Controller hook and types
    useOssAppRevisionController,
    type OssAppRevisionControllerState,
    type OssAppRevisionControllerDispatch,
    type OssAppRevisionControllerResult,
    type OssAppRevisionMolecule,
    type OssAppRevisionSelectionConfig,
} from "./state"

// Re-export store atoms for direct access if needed
export {
    // Query atoms
    ossAppRevisionQueryAtomFamily,
    ossAppRevisionDraftAtomFamily,
    ossAppRevisionEntityAtomFamily,
    ossAppRevisionIsDirtyAtomFamily,
    ossAppRevisionInputPortsAtomFamily,
    type OssAppRevisionInputPort,
    // Enriched query atoms (with URI from variant)
    enrichedQueryAtomFamily,
    variantDetailCacheAtomFamily,
    ossAppRevisionEnrichedDataFamily,
    createEnrichedKey,
    type EnrichedQueryKey,
    // Entity atoms with enrichment support
    ossAppRevisionEntityWithBridgeAtomFamily,
    ossAppRevisionServerDataSelectorFamily,
    ossAppRevisionIsDirtyWithBridgeAtomFamily,
    // Legacy atoms (deprecated - use enriched query pattern)
    ossAppRevisionServerDataAtomFamily,
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
    updateOssAppRevisionAtom,
    discardOssAppRevisionDraftAtom,
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
} from "./state"

// Re-export schema atoms
export {
    ossAppRevisionSchemaQueryAtomFamily,
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
    customPropertyMetadataAtom,
    type EnhancedCustomProperty,
    // Enhanced prompts (with values)
    revisionEnhancedPromptsAtomFamily,
    revisionPromptKeysAtomFamily,
    type EnhancedPrompt,
} from "./state"

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
    ossAppRevisionRunnableExtension,
    type OssAppRevisionOutputPort,
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
    // Re-exports
    isLocalDraftId,
    extractSourceIdFromDraft,
    // Types
    type LocalDraftEntry,
} from "./state"
