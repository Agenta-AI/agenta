/**
 * LegacyAppRevision Utilities
 *
 * @packageDocumentation
 */

export {stripVolatileKeys} from "./parameterConversion"

export {resolveRootSourceId} from "./sourceResolution"

export {
    // Detection helpers
    isPromptLikeStructure,
    isPromptLikeSchema,
    isPromptProperty,
} from "./specDerivation"

export {
    // Value extraction
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
    // Types
    type TransformVariantInput,
    type TransformMessage,
    type TransformToRequestBodyParams,
} from "./requestBodyBuilder"
