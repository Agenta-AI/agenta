/**
 * LegacyAppRevision Types
 *
 * Enhanced value pattern types and schema types moved from
 * OSS genericTransformer to the entity package.
 */

export type {
    // Enhanced value pattern
    Merge,
    Common,
    EnhancedConfigValue,
    EnhancedArrayValue,
    StartsWith__,
    EnhancedObjectConfig,
    Enhanced,
} from "./enhanced"

export type {
    // Schema base types
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
} from "./schema"
