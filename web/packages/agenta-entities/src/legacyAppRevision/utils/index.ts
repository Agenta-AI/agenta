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
    // Pure derivation functions
    deriveEnhancedPrompts,
    deriveEnhancedCustomProperties,
    // Detection helpers
    isPromptLikeStructure,
    isPromptLikeSchema,
    isPromptProperty,
    enhanceToolsArray,
    // Metadata pre-heating
    preheatSchemaMetadata,
    // Types
    type EnhancedPrompt,
    type EnhancedCustomProperty,
} from "./specDerivation"
