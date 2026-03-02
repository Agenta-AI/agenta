/**
 * Shared Utilities
 *
 * Common utilities for schema handling, data transformation, and helper functions.
 *
 * @example
 * ```typescript
 * import { getSchemaAtPath, parseISODate, isLocalId } from './utils'
 *
 * // Zod schema utilities
 * import { createEntitySchemaSet, createLocalEntityFactory } from './utils'
 * ```
 */

// Schema utilities (JSON Schema / UI Schema)
export {
    // Types
    type SchemaProperty as EntitySchemaProperty,
    type EvaluatorField,
    type EntitySchema,
    // Navigation
    getSchemaAtPath,
    getSchemaKeys,
    isArrayPath,
    // Defaults
    getDefaultValue,
    createDefaultArrayItem,
    // Conversion
    evaluatorFieldToSchema,
    evaluatorFieldsToSchema,
    // Extraction
    extractPromptSchema,
    extractCustomPropertiesSchema,
    // Message schemas
    messageSchema,
    messagesSchema,
} from "./schema"

// Zod schema utilities
export {
    // Types
    type SafeParseResult,
    type EntitySchemaSetConfig,
    type EntitySchemaSet,
    type LocalEntityFactory,
    type InferBase,
    type InferCreate,
    type InferUpdate,
    type InferLocal,
    // Schema set factory
    createEntitySchemaSet,
    // Local entity factory
    createLocalEntityFactory,
    createTrackedEntityFactory,
    defaultIdGenerator,
    // Safe parsing
    safeParseWithErrors,
    safeParseWithLogging,
    parseOrThrow,
    // Response schemas
    createPaginatedResponseSchema,
    createBatchOperationSchema,
    // Common field schemas
    timestampFieldsSchema,
    auditFieldsSchema,
    jsonValueSchema,
    COMMON_SERVER_FIELDS,
} from "./zodSchema"

// Transform utilities
export {
    // Types
    type TimestampFields,
    type DateParser,
    // Factories
    createTimestampNormalizer,
    createFieldTransformer,
    composeTransforms,
    // Built-in
    parseISODate,
    normalizeTimestampsBasic,
} from "./transforms"

// Helper utilities
export {
    // ID utilities
    isLocalId,
    isServerId,
    generateLocalId,
    // Batch utilities
    batchUpdate,
    batchCreate,
    batchDelete,
    // Cache utilities (advanced)
    createCacheConfig,
    populateChildCache,
    // Composition utilities (advanced)
    createRelation,
    getChildIds,
    getChildData,
    createChildIdsAtom,
    createChildrenAtom,
    // Typing utilities (internal)
    hasRequiredFields,
    assertSchema,
    safeParseSchema,
} from "./helpers"

// Latest entity query factory
export {
    createLatestEntityQueryFactory,
    type CreateLatestEntityQueryConfig,
    type LatestEntityQueryParams,
} from "./latestEntityQuery"

// Null-safe atom utilities
export {
    // Atom factories
    createNullQueryResultAtom,
    createNullDataAtom,
    // Selector factories
    createNullSafeQuerySelector,
    createNullSafeDataSelector,
    // Convenience factory
    createNullSafeSelectors,
    // Types
    type NullQueryResult,
    type AtomFamilyFn,
    type CreateNullSafeSelectorsConfig,
    type NullSafeSelectors,
} from "./nullSafeAtoms"

// Revision label utilities
export {
    // Types
    type VersionedEntity,
    type RevisionLabelOptions,
    type RevisionLabelInfo,
    // Local draft detection
    isLocalDraftId,
    extractSourceIdFromDraft,
    // Placeholder ID detection
    isPlaceholderId,
    // Version formatting
    getVersionLabel,
    formatLocalDraftLabel,
    // Revision label formatting
    getRevisionLabel,
    getFullRevisionLabel,
    // Comprehensive label info
    getRevisionLabelInfo,
} from "./revisionLabel"

// Revision utilities (shared between appRevision and legacyAppRevision)
export {
    // Type guards
    isArray,
    isRecord,
    toArray,
    isValidUUID,
    // URI parsing
    type ParsedUriInfo,
    parseRevisionUri,
    extractRuntimePrefix,
    extractRoutePath,
    // Revision parameter extraction
    type RawAgConfig,
    extractRevisionParameters,
    extractRevisionParametersFromEnhanced,
    extractRevisionParametersFromApiRevision,
    // Deprecated agConfig aliases
    extractAgConfig,
    extractAgConfigFromEnhanced,
    extractAgConfigFromApiRevision,
    // List item types
    type AppListItem,
    type VariantListItem,
    type RevisionListItem,
    // API response types
    type ApiVariant,
    type ApiRevisionListItem,
    type ApiApp,
    // Transform utilities
    transformAppToListItem,
    transformVariantToListItem,
    transformRevisionToListItem,
    // Enhanced variant types
    type EnhancedVariantLike,
    extractUriFromEnhanced,
} from "./revisionUtils"
