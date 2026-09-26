/**
 * @agenta/shared - Shared utilities for Agenta packages
 *
 * This package provides shared primitives that can be used by other packages
 * and apps in the Agenta monorepo.
 *
 * ## API Utilities
 * - `getAgentaApiUrl()` - Get the Agenta API URL
 * - `getEnv(key)` - Get environment variable with runtime override support
 * - `axios` - Configured axios instance
 *
 * ## State Atoms
 * - `projectIdAtom` - Current project ID (populated by app)
 * - Jotai recipes: `atomWithDebounce`, `atomWithRefresh`
 *
 * ## Chat Message Utilities
 * - Types: `SimpleChatMessage`, `MessageContent`, `ToolCall`, etc.
 * - Utilities: `extractTextFromContent`, `hasAttachments`, etc.
 * - Schemas: `CHAT_MESSAGE_SCHEMA`, `CHAT_MESSAGES_ARRAY_SCHEMA`
 *
 * ## Hooks
 * - `useDebounceInput` - Debounced input handling with synchronized state
 *
 * @example
 * ```typescript
 * import { projectIdAtom, getAgentaApiUrl, axios } from '@agenta/shared'
 *
 * // Use in entity atoms
 * const myQueryAtom = atomWithQuery((get) => {
 *   const projectId = get(projectIdAtom)
 *   return {
 *     queryKey: ['my-query', projectId],
 *     queryFn: () => axios.get(`${getAgentaApiUrl()}/my-endpoint`),
 *     enabled: !!projectId,
 *   }
 * })
 * ```
 */

// API utilities
export {
    getEnv,
    getAgentaApiUrl,
    processEnv,
    axios,
    createAxiosInstance,
    configureAxios,
    resetAxiosConfig,
    queryClient,
} from "./api"
export type {AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosInterceptorConfig} from "./api"

// State atoms
export {projectIdAtom, setProjectIdAtom, atomWithRefresh, atomWithDebounce} from "./state"
export type {DebouncedAtomBundle} from "./state"

// Utilities
export {
    isValidHttpUrl,
    isValidRegex,
    isValidUUID,
    validateUUID,
    extractApiErrorMessage,
    createBatchFetcher,
    filterItems,
    formatEnumLabel,
    getOptionsFromSchema,
} from "./utils"
export type {
    BatchFetcher,
    BatchFetcherOptions,
    BatchFnResponse,
    FilterItemLabel,
    OptionGroup,
} from "./utils"

// Date/time utilities
export {dayjs, normalizeTimestamps, normalizeEntityTimestamps, parseEntityDate} from "./utils"

// Path utilities for nested data navigation
export {
    getValueAtPath,
    getValueAtStringPath,
    setValueAtPath,
    deleteValueAtPath,
    hasValueAtPath,
    isExpandable,
    getChildCount,
    getItemsAtPath,
    parsePath,
    collectPaths,
    // Typed path utilities for UI selection
    extractTypedPaths,
} from "./utils"
export type {
    PathSegment,
    DataPath,
    PathItem,
    TypedPathInfo,
    ExtractTypedPathsOptions,
} from "./utils"

// Type narrowing utilities
export {asRecord, safeStringify} from "./utils"

// Chat message utilities
export {
    extractTextFromContent,
    extractDisplayTextFromMessage,
    hasAttachments,
    updateTextInContent,
    addImageToContent,
    addFileToContent,
    removeAttachmentFromContent,
    getAttachments,
    isChatMessageObject,
    isChatMessagesArray,
    tryParseArrayFromString,
    normalizeMessagesFromField,
    deriveToolViewModelFromResult,
    normalizeEnhancedMessages,
    extractPromptTemplateContext,
} from "./utils"

// Logger utilities
export {createLogger} from "./utils"
export type {LoggerOptions} from "./utils"

// JSON parsing utilities
export {tryParsePartialJson, safeJson5Parse} from "./utils"

// JSON detection utilities
export {
    isPlainObject,
    isJsonString,
    tryParseJson,
    tryParseAsObject,
    tryParseAsArray,
    tryParseJsonValue,
} from "./utils"
export type {JsonParseResult} from "./utils"

// Editor language detection utilities
export {detectEditorLanguage, getContentLanguage, type EditorLanguage} from "./utils"

// OpenAPI schema utilities
export {dereferenceSchema, type DereferencedSchemaResult} from "./utils"

// Chat message types
export type {
    TextContentPart,
    ImageContentPart,
    FileContentPart,
    MessageContentPart,
    MessageContent,
    ToolCall,
    SimpleChatMessage,
} from "./types"

// Chat message schemas
export {MESSAGE_CONTENT_SCHEMA, CHAT_MESSAGE_SCHEMA, CHAT_MESSAGES_ARRAY_SCHEMA} from "./schemas"

// Hooks
export {
    useDebounceInput,
    useLazyEffect,
    useSelectionState,
    useRunAllShortcut,
    useModifierKey,
} from "./hooks"
export type {UseSelectionStateResult} from "./hooks"
export type {UseRunAllShortcutParams} from "./hooks"

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
    formatPreviewValue,
    createFormatter,
} from "./utils"
export type {FormatterOptions, Formatter} from "./utils"

// Pluralization utilities
export {pluralize, formatCount} from "./utils"

// ID generation utilities
export {generateId} from "./utils"

// Data URI / Base64 / URL detection utilities
export {isBase64, dataUriToObjectUrl, isUrl} from "./utils"

// Value extraction utilities (strip enhanced wrappers / metadata)
export {stripAgentaMetadataDeep, stripEmptyCollectionsDeep, stripEnhancedWrappers} from "./utils"

// Status inference utilities
export {toFiniteNumber, getStatusLabel, getStatusSeverity, inferStatusFromSummary} from "./utils"
export type {ExecutionStatus, ExecutionSummary, StatusSeverity} from "./utils"

// Mapping utilities for input/output mappings
export {
    determineMappingStatus,
    getMappingStatusConfig,
    isMappingError,
    isMappingWarning,
    isMappingComplete,
    validateMappings,
} from "./utils"
export type {
    MappingStatus,
    MappingStatusConfig,
    MappingLike,
    MappingValidationResult,
} from "./utils"
