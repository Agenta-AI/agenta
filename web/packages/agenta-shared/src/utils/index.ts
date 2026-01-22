/**
 * Utility functions for Agenta packages.
 */

export {isValidHttpUrl, isValidRegex, isValidUUID, validateUUID} from "./validators"
export {createBatchFetcher} from "./createBatchFetcher"
export type {BatchFetcher, BatchFetcherOptions, BatchFnResponse} from "./createBatchFetcher"

// Date/time utilities
export {default as dayjs} from "./dayjs"
export {normalizeTimestamps, normalizeEntityTimestamps, parseEntityDate} from "./entityTransforms"

// Path utilities for nested data navigation
export {
    getValueAtPath,
    getValueAtStringPath,
    setValueAtPath,
    deleteValueAtPath,
    hasValueAtPath,
    isExpandable,
    getValueType,
    getChildCount,
    getItemsAtPath,
    parsePath,
    pathToString,
    getParentPath,
    getLastSegment,
    isChildPath,
    collectPaths,
} from "./pathUtils"
export type {PathSegment, DataPath, PathItem} from "./pathUtils"

// Chat message utilities
export {
    extractTextFromContent,
    extractDisplayTextFromMessage,
    hasAttachments,
    getAttachmentInfo,
    updateTextInContent,
    addImageToContent,
    addFileToContent,
    removeAttachmentFromContent,
    getAttachments,
} from "./chatMessage"

// Logger utilities
export {createLogger} from "./createLogger"
export type {LoggerOptions} from "./createLogger"

// JSON parsing utilities
export {tryParsePartialJson, safeJson5Parse} from "./jsonParsing"

// Key path utilities
export {keyToString, stringToKeyPath} from "./keyUtils"

// JSON detection utilities
export {
    isPlainObject,
    isJsonString,
    isJsonObject,
    isJsonArray,
    tryParseJson,
    tryParseAsObject,
    tryParseAsArray,
    canExpandAsJson,
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

// Formatting utilities
export {
    formatNumber,
    formatCompact,
    formatCompactNumber, // deprecated alias
    formatCurrency,
    formatLatency,
    formatTokens,
    formatTokenUsage, // deprecated alias
    formatPercent,
    formatSignificant,
    createFormatter,
} from "./formatters/index"
export type {FormatterOptions, Formatter} from "./formatters/index"

// Pluralization utilities
export {pluralize, formatCount} from "./pluralize"
