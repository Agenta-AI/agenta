/**
 * Shared Utilities
 *
 * Common utilities for schema handling, data transformation, and helper functions.
 *
 * @example
 * ```typescript
 * import { getSchemaAtPath, parseISODate } from './utils'
 *
 * // Zod schema utilities
 * import { createEntitySchemaSet } from './utils'
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
    // Defaults
    getDefaultValue,
    // Conversion
    evaluatorFieldToSchema,
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
    // Schema set factory
    createEntitySchemaSet,
    // Local entity factory
    defaultIdGenerator,
    // Safe parsing
    safeParseWithErrors,
    safeParseWithLogging,
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
    // Built-in
    parseISODate,
} from "./transforms"

// Date formatting utilities
export {
    type EntityDateInput,
    type EntityDateTimeFormatOptions,
    formatEntityDateTime,
} from "./dateTime"

// Helper utilities
export {
    // ID utilities
    generateLocalId,
    // Batch utilities
    batchUpdate,
    // Composition utilities (advanced)
    getChildIds,
    getChildData,
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

// Revision utilities
export {
    // Type guards
    isArray,
    isRecord,
    toArray,
    isValidUUID,
    // URI parsing
    type ParsedUriInfo,
    parseRevisionUri,
    // Revision parameter extraction
    type RawAgConfig,
    extractRevisionParameters,
    extractRevisionParametersFromApiRevision,
    // List item types
    type AppListItem,
    type VariantListItem,
    type RevisionListItem,
    // API response types
    type ApiVariant,
    type ApiRevisionListItem,
} from "./revisionUtils"
