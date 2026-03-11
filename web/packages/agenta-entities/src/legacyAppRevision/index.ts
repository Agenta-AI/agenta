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
    apiAppVariantRevisionSchema,
    configDBSchema,
    createEmptyLegacyAppRevision,
    createEmptySchemaState,
    // Zod schemas
    executionModeSchema,
    legacyAppRevisionDataSchema,
    // Parse utilities
    parseLegacyAppRevision,
} from "./core"

export type {
    ApiAppVariantRevision,
    // Backend types
    ConfigDB,
    EndpointSchema,
    // Re-exports
    EntitySchema,
    EntitySchemaProperty,
    // Execution mode
    ExecutionMode,
    LegacyAppRevisionBatchParams,
    // Data types
    LegacyAppRevisionData,
    // API params
    LegacyAppRevisionDetailParams,
    LegacyAppRevisionListParams,
    // Selection types
    LegacyAppRevisionSelectionResult,
    RevisionSchemaState,
} from "./core"

// ============================================================================
// FACTORY - Local Draft Creation
// ============================================================================

export {
    cloneAsLocalDraft,
    createLocalLegacyAppRevision,
    type CreateLocalLegacyAppRevisionParams,
    type LocalLegacyAppRevision,
} from "./core/factory"

// ============================================================================
// RELATIONS - Entity Hierarchy Definitions
// ============================================================================

export {
    // Relations
    ossAppToVariantRelation,
    // Root-level atom
    ossAppsListAtom,
    ossVariantToRevisionRelation,
    // Registration function
    registerLegacyAppRevisionRelations,
    // Types
    type OssAppRootEntity,
} from "./relations"

// ============================================================================
// API - HTTP Functions and Transformers
// ============================================================================

export {
    buildRevisionSchemaState,
    constructEndpointPath,
    // Schema conversion (openapi-json-schema)
    convertOpenApiSchemaToJsonSchema,
    extractAllEndpointSchemas,
    extractEndpointSchema,
    // List API functions
    fetchAppsList,
    // Fetch functions
    fetchOssRevision,
    fetchOssRevisionById,
    fetchOssRevisionEnriched,
    fetchOssRevisionsBatch,
    // Batch fetchers
    revisionBatchFetcher,
    variantDetailBatchFetcher,
    revisionsListBatchFetcher,
    // Cache invalidation
    clearVariantDetailCache,
    // URI utilities
    // Schema functions
    fetchRevisionSchema,
    fetchRevisionSchemaWithProbe,
    fetchRevisionsList,
    fetchVariantDetail,
    fetchVariantsList,
    // Validation
    isValidUUID,
    jsonSchemaToEntitySchema,
    // URI utilities
    normalizeUri,
    // URI probing functions
    probeEndpointPath,
    type ApiApp,
    type ApiRevisionListItem,
    type ApiVariant,
    type ApiVariantDetail,
    type AppListItem,
    type OpenAPISpec,
    type RevisionListItem,
    type RevisionsQueryRequest,
    type RevisionsQueryResponse,
    // Types
    type TransformContext,
    type VariantDetail,
    type VariantListItem,
} from "./api"

// ============================================================================
// STATE - Molecule and Store Atoms
// ============================================================================

export {
    legacyAppRevisionMolecule,
    legacyAppRevisionSelectionConfig,
    // Controller hook and types
    useLegacyAppRevisionController,
    type LegacyAppRevisionControllerDispatch,
    type LegacyAppRevisionControllerResult,
    type LegacyAppRevisionControllerState,
    type LegacyAppRevisionMolecule,
    type LegacyAppRevisionSelectionConfig,
} from "./state"

// ============================================================================
// SNAPSHOT - Draft Patch Helpers for URL Sharing
// ============================================================================

export {
    applyLegacyAppRevisionDraftPatch,
    buildLegacyAppRevisionDraftPatch,
    hasDraftChanges,
    initializeServerData,
    type BuildPatchResult,
    type LegacyAppRevisionDraftPatch,
} from "./snapshot"
export {legacyAppRevisionSnapshotAdapter} from "./snapshotAdapter"

// Auto-register snapshot adapter when this module is imported
// This ensures the adapter is available in the registry for snapshot operations
import "./snapshotAdapter"

// Re-export store atoms for direct access if needed
export {
    // List atoms with local drafts
    LOCAL_DRAFTS_VARIANT_ID,
    appRevisionsWithDraftsAtomFamily,
    // List atoms
    appsListAtom,
    appsQueryAtom,
    clearServerDataAtom,
    createEnrichedKey,
    discardLegacyAppRevisionDraftAtom,
    // Enriched query atoms (with URI from variant)
    enrichedQueryAtomFamily,
    latestServerRevisionIdAtomFamily,
    legacyAppRevisionDraftAtomFamily,
    legacyAppRevisionEnrichedDataFamily,
    legacyAppRevisionEntityAtomFamily,
    // Entity atoms with enrichment support
    legacyAppRevisionEntityWithBridgeAtomFamily,
    legacyAppRevisionInputPortsAtomFamily,
    legacyAppRevisionIsDirtyAtomFamily,
    legacyAppRevisionIsDirtyWithBridgeAtomFamily,
    // Query atoms
    legacyAppRevisionQueryAtomFamily,
    // Bridge server data (written imperatively, read by entity/molecule atoms)
    legacyAppRevisionServerDataAtomFamily,
    legacyAppRevisionServerDataSelectorFamily,
    // Cache management
    revisionCacheVersionAtom,
    revisionsListAtomFamily,
    revisionsListQueryStateAtomFamily,
    revisionsListWithDraftsAtomFamily,
    revisionsQueryAtomFamily,
    // Override functions
    setAppsListAtom,
    setRevisionsListAtomFamily,
    // Server data management
    setServerDataAtom,
    setVariantsListAtomFamily,
    // Mutations
    updateLegacyAppRevisionAtom,
    variantDetailCacheAtomFamily,
    variantsListAtomFamily,
    variantsListQueryStateAtomFamily,
    variantsListWithDraftsAtomFamily,
    variantsQueryAtomFamily,
    type EnrichedQueryKey,
    type LegacyAppRevisionInputPort,
    type RevisionListItemWithDrafts,
    type VariantListItemWithDrafts,
} from "./state"

// Re-export schema atoms
export {
    chatServiceSchemaAtom,
    // Service schema prefetch atoms (mount in app root for eager fetch)
    completionServiceSchemaAtom,
    getSchemaPropertyAtPath,
    legacyAppRevisionSchemaQueryAtomFamily,
    revisionAgConfigSchemaAtomFamily,
    revisionCustomPropertiesSchemaAtomFamily,
    revisionEndpointsAtomFamily,
    revisionOpenApiSchemaAtomFamily,
    revisionPromptSchemaAtomFamily,
    revisionSchemaAtPathAtomFamily,
} from "./state"

// ============================================================================
// TYPES - Enhanced Value Pattern & Schema Types
// ============================================================================

export type {
    AnyOfSchema,
    ArrayMetadata,
    ArraySchema,
    // Schema types
    Base,
    BaseMetadata,
    BaseOption,
    BaseSchema,
    BaseSchemaProperties,
    BooleanMetadata,
    Common,
    CompoundOption,
    // Metadata types (canonical home — formerly in metadataAtoms.ts)
    ConfigMetadata,
    ConstDiscriminatedSchema,
    Enhanced,
    EnhancedArrayValue,
    EnhancedConfigValue,
    EnhancedObjectConfig,
    ExtractedSchema,
    // Enhanced value pattern
    Merge,
    NumberMetadata,
    ObjectMetadata,
    ObjectSchema,
    ObjectWithConstSchema,
    OpenAPISpecStrict,
    OptionGroup,
    PrimitiveSchema,
    PrimitiveSchemaType,
    SchemaProperty,
    SchemaType,
    SelectOptions,
    StartsWith__,
    StringMetadata,
    WithEnum,
} from "./types"

// Re-export spec derivation utilities (pure functions)
export {
    areParametersDifferent,
    enhancedCustomPropertiesToParameters,
    enhancedPromptsToParameters,
    // Input helpers
    extractInputKeysFromSchema,
    extractInputValues,
    extractRawValue,
    // Parameter extraction
    extractVariantParameters,
    isPromptLikeSchema,
    // Detection helpers
    isPromptLikeStructure,
    isPromptProperty,
    resolveRootSourceId,
    // Value extraction
    stripAgentaMetadataDeep,
    stripEnhancedWrappers,
    stripVolatileKeys,
    toSnakeCase,
    // Request body builder
    transformToRequestBody,
    type TransformMessage,
    type TransformToRequestBodyParams,
    // Request body types
    type TransformVariantInput,
} from "./utils"

// Re-export runnable extension
export {
    legacyAppRevisionRunnableExtension,
    runnableAtoms,
    runnableGet,
    runnableReducers,
    runnableSet,
    type LegacyAppRevisionOutputPort,
} from "./state"

// ============================================================================
// COMMIT
// ============================================================================

export {
    clearCommitCallbacks,
    commitRevision,
    // Commit atom and function
    commitRevisionAtom,
    // Utilities
    newestRevisionForVariantAtomFamily,
    // Callback registration
    registerCommitCallbacks,
    waitForNewRevision,
    type CommitCallbacks,
    type CommitResult,
    type CommitRevisionError,
    // Types
    type CommitRevisionParams,
    type CommitRevisionResult,
} from "./state"

// ============================================================================
// CREATE VARIANT
// ============================================================================

export {
    clearCreateVariantCallbacks,
    createVariantAtom,
    registerCreateVariantCallbacks,
    type CreateVariantCallbacks,
    type CreateVariantError,
    type CreateVariantOutcome,
    type CreateVariantParams,
    type CreateVariantResult,
} from "./state"

// ============================================================================
// DELETE REVISION
// ============================================================================

export {
    clearDeleteRevisionCallbacks,
    deleteRevisionAtom,
    registerDeleteRevisionCallbacks,
    type DeleteRevisionCallbacks,
    type DeleteRevisionError,
    type DeleteRevisionOutcome,
    type DeleteRevisionParams,
    type DeleteRevisionResult,
} from "./state"

// ============================================================================
// DEPLOY (LEGACY-COMPAT)
// ============================================================================

export {
    publishMutationAtom,
    type PublishPayload,
    type PublishRevisionPayload,
    type PublishVariantPayload,
} from "./state"

// ============================================================================
// ENTITY QUERY INVALIDATION
// ============================================================================

export {invalidateEntityQueries} from "./state"

// ============================================================================
// LOCAL DRAFTS - Entity-level local draft management
// ============================================================================

export {
    cleanupStaleLocalDrafts,
    // Imperative functions
    createLocalDraftFromRevision,
    discardAllLocalDrafts,
    discardLocalDraft,
    discardRevisionDraftAtom,
    extractSourceIdFromDraft,
    getSourceRevisionId,
    hasUnsavedLocalDraftsAtom,
    initializeLocalDrafts,
    // Re-exports
    isLocalDraftId,
    isLocalDraftsGroupId,
    // App-scoped latest revision
    latestAppRevisionIdAtom,
    // Backward-compat global atoms (use families when appId is available)
    localDraftIdsAtom,
    // Atom families (preferred — explicit app scoping)
    localDraftIdsAtomFamily,
    localDraftsListAtomFamily,
    // App ID registration (called from OSS bridge)
    registerAppIdAtom,
} from "./state"

// ============================================================================
// DRAFT PERSISTENCE - localStorage backup for draft state
// ============================================================================

export {
    cleanupStalePersistedDrafts,
    clearPersistedDraft,
    clearPersistedLocalDraftData,
    getPersistedDraftPatches,
    // Imperative functions
    persistDraftPatch,
    persistLocalDraftData,
    // Atoms (for direct access if needed)
    persistedDraftPatchesAtom,
    persistedLocalDraftDataAtom,
    restoreAllLocalDraftData,
    restorePersistedDraft,
    // Types
    type PersistedDraftPatch,
    type PersistedLocalDraftData,
} from "./state"
