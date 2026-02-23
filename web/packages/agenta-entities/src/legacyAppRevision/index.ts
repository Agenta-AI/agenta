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
    // URI probing functions
    probeEndpointPath,
    fetchRevisionSchemaWithProbe,
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
    appRevisionsWithDraftsAtomFamily,
    latestServerRevisionIdAtomFamily,
    type VariantListItemWithDrafts,
    type RevisionListItemWithDrafts,
    // Mutations
    updateLegacyAppRevisionAtom,
    discardLegacyAppRevisionDraftAtom,
    // Server data management
    setServerDataAtom,
    clearServerDataAtom,
    // Read utilities
    findPropertyInObject,
    findPropertyInArray,
    // Template format
    sanitizeTemplateFormat,
    getTemplateFormatNode,
    getTemplateFormatValue,
    getTemplateFormatPropertyId,
    DEFAULT_TEMPLATE_FORMAT,
    type PromptTemplateFormat,
    setVariantsListAtomFamily,
    setRevisionsListAtomFamily,
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
} from "./state"

// ============================================================================
// TYPES - Enhanced Value Pattern & Schema Types
// ============================================================================

export type {
    // Enhanced value pattern
    Merge,
    Common,
    EnhancedConfigValue,
    EnhancedArrayValue,
    StartsWith__,
    EnhancedObjectConfig,
    Enhanced,
    // Schema types
    Base,
    CompoundOption,
    SchemaType,
    BaseSchema,
    BaseSchemaProperties,
    WithEnum,
    SchemaProperty,
    ObjectSchema,
    PrimitiveSchema,
    ArraySchema,
    AnyOfSchema,
    ObjectWithConstSchema,
    ConstDiscriminatedSchema,
    PrimitiveSchemaType,
    ExtractedSchema,
    OpenAPISpecStrict,
} from "./types"

// Re-export spec derivation utilities (pure functions)
export {
    extractRawValue,
    stripVolatileKeys,
    areParametersDifferent,
    resolveRootSourceId,
    deriveEnhancedPrompts,
    deriveEnhancedCustomProperties,
    // OpenAPI spec convenience wrappers
    extractVariantParameters,
    derivePromptsFromOpenApiSpec,
    deriveCustomPropertiesFromOpenApiSpec,
    // Detection helpers
    isPromptLikeStructure,
    isPromptLikeSchema,
    isPromptProperty,
    enhanceToolsArray,
    // Parameter conversion helpers
    enhancedPromptsToParameters,
    enhancedCustomPropertiesToParameters,
    // Metadata helpers
    extractObjectSchemaFromMetadata,
    createObjectFromMetadata,
    // Value extraction
    extractValueByMetadata,
    stripAgentaMetadataDeep,
    stripEnhancedWrappers,
    toSnakeCase,
    // Input helpers
    extractInputKeysFromSchema,
    extractInputValues,
    // Request body builder
    transformToRequestBody,
    toRequestBodyCompletion,
    toRequestBodyChat,
    // Request body types
    type TransformVariantInput,
    type TransformMessage,
    type TransformToRequestBodyParams,
    // Message from schema
    createMessageFromSchema,
    setMessageSchemaMetadataAccessor,
} from "./utils"

/**
 * Re-export metadata atoms.
 *
 * @deprecated Prefer using `legacyAppRevisionMolecule.metadata.*` for metadata access.
 */
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
    hashConfigMetadata,
    isObjectMetadata,
    // Types
    type ConfigMetadata,
    type BaseMetadata,
    type StringMetadata,
    type NumberMetadata,
    type BooleanMetadata,
    type ArrayMetadata,
    type ObjectMetadata,
    type BaseOption,
    type OptionGroup,
    type SelectOptions,
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
    waitForNewRevision,
    // Types
    type CommitRevisionParams,
    type CommitRevisionResult,
    type CommitRevisionError,
    type CommitResult,
    type CommitCallbacks,
} from "./state"

// ============================================================================
// CREATE VARIANT
// ============================================================================

export {
    createVariantAtom,
    registerCreateVariantCallbacks,
    clearCreateVariantCallbacks,
    type CreateVariantParams,
    type CreateVariantResult,
    type CreateVariantError,
    type CreateVariantOutcome,
    type CreateVariantCallbacks,
} from "./state"

// ============================================================================
// DELETE REVISION
// ============================================================================

export {
    deleteRevisionAtom,
    registerDeleteRevisionCallbacks,
    clearDeleteRevisionCallbacks,
    type DeleteRevisionParams,
    type DeleteRevisionResult,
    type DeleteRevisionError,
    type DeleteRevisionOutcome,
    type DeleteRevisionCallbacks,
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
    // Atom families (preferred — explicit app scoping)
    localDraftIdsAtomFamily,
    localDraftsListAtomFamily,
    // Backward-compat global atoms (use families when appId is available)
    localDraftIdsAtom,
    hasUnsavedLocalDraftsAtom,
    // App-scoped latest revision
    latestAppRevisionIdAtom,
    // Imperative functions
    createLocalDraftFromRevision,
    getSourceRevisionId,
    // App ID registration (called from OSS bridge)
    registerAppIdAtom,
    // Re-exports
    isLocalDraftId,
    extractSourceIdFromDraft,
    isLocalDraftsGroupId,
} from "./state"
