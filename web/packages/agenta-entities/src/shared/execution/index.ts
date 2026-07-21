/**
 * Shared Execution Utilities
 *
 * Entity-agnostic utilities for building request bodies, extracting values,
 * and working with enhanced config metadata.
 *
 * @packageDocumentation
 */

// Types
export type {
    ConfigMetadata,
    ObjectMetadata,
    BaseMetadata,
    StringMetadata,
    NumberMetadata,
    BooleanMetadata,
    ArrayMetadata,
    BaseOption,
    OptionGroup,
    SelectOptions,
    Enhanced,
    EnhancedObjectConfig,
    EnhancedConfigValue,
    EnhancedArrayValue,
    Common,
    StartsWith__,
    Merge,
    ObjectSchema,
    Base,
    CompoundOption,
    SchemaType,
    BaseSchema,
    BaseSchemaProperties,
    WithEnum,
    SchemaProperty,
    PrimitiveSchema,
    ArraySchema,
    AnyOfSchema,
    ObjectWithConstSchema,
    ConstDiscriminatedSchema,
    PrimitiveSchemaType,
    ExtractedSchema,
    OpenAPISpecStrict,
} from "./types"

// Value extraction
export {
    extractValueByMetadata,
    stripAgentaMetadataDeep,
    stripEnhancedWrappers,
    toSnakeCase,
    extractInputKeysFromSchema,
    extractInputValues,
} from "./valueExtraction"

// Invocation error reporting
export {
    MISSING_INVOCATION_URL_ERROR,
    isHtmlBody,
    describeUnreachableService,
} from "./invocationErrors"

// Step error reporting
export {extractStepError, type StepError} from "./stepErrors"

// Request body builder
export {
    transformToRequestBody,
    toRequestBodyCompletion,
    toRequestBodyChat,
    type TransformVariantInput,
    type TransformMessage,
    type TransformToRequestBodyParams,
} from "./requestBodyBuilder"
