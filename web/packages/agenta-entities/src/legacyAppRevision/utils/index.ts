/**
 * LegacyAppRevision Utilities
 *
 * @packageDocumentation
 */

export {
    extractRawValue,
    stripVolatileKeys,
    enhancedPromptsToParameters,
    enhancedCustomPropertiesToParameters,
    areParametersDifferent,
} from "./parameterConversion"

export {resolveRootSourceId} from "./sourceResolution"

export {
    // Detection helpers
    isPromptLikeStructure,
    isPromptLikeSchema,
    isPromptProperty,
    // Parameter extraction
    extractVariantParameters,
    // Types
    type EnhancedPrompt,
    type EnhancedCustomProperty,
} from "./specDerivation"

export {
    // Metadata navigation and object creation
    extractObjectSchemaFromMetadata,
    createObjectFromMetadata,
} from "./metadataHelpers"

export {
    // Value extraction
    extractValueByMetadata,
    stripAgentaMetadataDeep,
    stripEnhancedWrappers,
    toSnakeCase,
    // Input helpers
    extractInputKeysFromSchema,
    extractInputValues,
} from "./valueExtraction"

export {
    // Request body builder
    transformToRequestBody,
    toRequestBodyCompletion,
    toRequestBodyChat,
    // Types
    type TransformVariantInput,
    type TransformMessage,
    type TransformToRequestBodyParams,
} from "./requestBodyBuilder"

export {
    // Message from schema
    createMessageFromSchema,
    setMessageSchemaMetadataAccessor,
} from "./messageFromSchema"
