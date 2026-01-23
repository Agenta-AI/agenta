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
