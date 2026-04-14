/**
 * Utility functions for Agenta packages.
 */

export {createBatchFetcher} from "./createBatchFetcher"
export type {BatchFetcher, BatchFetcherOptions, BatchFnResponse} from "./createBatchFetcher"
export {isValidHttpUrl, isValidRegex, isValidUUID, validateUUID} from "./validators"

// Filtering utilities
export {filterItems} from "./filterItems"
export type {FilterItemLabel} from "./filterItems"

// Date/time utilities
export {default as dayjs} from "./dayjs"
export {normalizeEntityTimestamps, normalizeTimestamps, parseEntityDate} from "./entityTransforms"

// Path utilities for nested data navigation
export {
    buildTestcaseColumnPaths,
    collectPaths,
    combineTypedPaths,
    deleteValueAtPath,
    // Typed path utilities for UI selection components
    extractTypedPaths,
    getChildCount,
    getItemsAtPath,
    getLastSegment,
    getParentPath,
    getValueAtPath,
    getValueAtStringPath,
    getValueType,
    hasValueAtPath,
    isChildPath,
    isExpandable,
    parsePath,
    pathToString,
    setValueAtPath,
} from "./pathUtils"
export type {
    DataPath,
    ExtractTypedPathsOptions,
    PathItem,
    PathSegment,
    TypedPathInfo,
} from "./pathUtils"

// Type narrowing utilities
export {asRecord, safeStringify} from "./typeNarrowing"

// Chat message utilities
export {
    addFileToContent,
    addImageToContent,
    deriveToolViewModelFromResult,
    extractDisplayTextFromMessage,
    extractTextFromContent,
    getAttachmentInfo,
    getAttachments,
    hasAttachments,
    messageHasContent,
    messageHasToolCalls,
    normalizeMessagesFromField,
    removeAttachmentFromContent,
    tryParseArrayFromString,
    updateTextInContent,
} from "./chatMessage"
export {extractPromptTemplateContext, normalizeEnhancedMessages} from "./chatPrompts"

// Logger utilities
export {createLogger} from "./createLogger"
export type {LoggerOptions} from "./createLogger"

// JSON parsing utilities
export {safeJson5Parse, tryParsePartialJson} from "./jsonParsing"

// Key path utilities
export {keyToString, stringToKeyPath} from "./keyUtils"

// JSON detection utilities
export {
    canExpandAsJson,
    isJsonArray,
    isJsonObject,
    isJsonString,
    isPlainObject,
    tryParseAsArray,
    tryParseAsObject,
    tryParseJson,
    tryParseJsonValue,
} from "./jsonDetection"
export type {JsonParseResult} from "./jsonDetection"

// Editor language detection utilities
export {
    detectEditorLanguage,
    getContentLanguage,
    looksLikeJson,
    type EditorLanguage,
} from "./editorLanguage"

// OpenAPI schema utilities
export {dereferenceSchema, type DereferencedSchemaResult} from "./openapi"

// API error utilities
export {extractApiErrorMessage} from "./extractApiErrorMessage"

// Formatting utilities
export {
    createFormatter,
    formatCompact,
    formatCompactNumber, // deprecated alias
    formatCurrency,
    formatLatency,
    formatNumber, // deprecated alias
    formatPercent,
    formatPreviewValue,
    formatSignificant,
    formatTokenUsage,
    formatTokens,
} from "./formatters/index"
export type {Formatter, FormatterOptions} from "./formatters/index"

// Enum label utilities
export {formatEnumLabel} from "./formatEnumLabel"

// Schema options utilities
export {getOptionsFromSchema} from "./schemaOptions"
export type {OptionGroup} from "./schemaOptions"

// Pluralization utilities
export {formatCount, pluralize} from "./pluralize"

// ID generation utilities
export {generateId} from "./generateId"

// Data URI / Base64 / URL detection utilities
export {dataUriToObjectUrl, isBase64, isUrl} from "./dataUri"

// Value extraction utilities (strip enhanced wrappers / metadata)
export {stripAgentaMetadataDeep, stripEnhancedWrappers} from "./valueExtraction"

// Status inference utilities
export {
    getStatusColor,
    getStatusLabel,
    getStatusSeverity,
    inferStatusFromSummary,
    toFiniteNumber,
} from "./statusInference"
export type {ExecutionStatus, ExecutionSummary, StatusSeverity} from "./statusInference"

// Mapping utilities for input/output mappings
export {
    determineMappingStatus,
    getMappingStatusConfig,
    isMappingComplete,
    isMappingError,
    isMappingWarning,
    validateMappings,
} from "./mappingUtils"
export type {
    MappingLike,
    MappingStatus,
    MappingStatusConfig,
    MappingValidationResult,
} from "./mappingUtils"

// Gateway Tool Slug utilities
export {
    slugify as connectionSlugify,
    generateDefaultSlug,
    randomAlphanumeric,
} from "./connectionSlug"
export {buildGatewayToolSlug, isGatewayToolSlug, parseGatewayToolSlug} from "./toolSlug"

// Polling utilities
export {shortPoll} from "./shortPoll"

// URI utilities
export {removeTrailingSlash} from "./uriUtils"

// Trace ID conversion utilities (UUID ↔ OpenTelemetry)
export {uuidToSpanId, uuidToTraceId} from "./traceIds"
