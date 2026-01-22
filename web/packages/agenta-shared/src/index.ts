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
} from "./api"
export type {AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosInterceptorConfig} from "./api"

// State atoms
export {projectIdAtom, setProjectIdAtom} from "./state"

// Utilities
export {isValidHttpUrl, isValidRegex, isValidUUID, validateUUID, createBatchFetcher} from "./utils"
export type {BatchFetcher, BatchFetcherOptions, BatchFnResponse} from "./utils"

// Date/time utilities
export {dayjs, normalizeTimestamps, normalizeEntityTimestamps, parseEntityDate} from "./utils"

// Path utilities for nested data navigation
export {
    getValueAtPath,
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
} from "./utils"
export type {PathSegment, DataPath, PathItem} from "./utils"

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
} from "./utils"

// Logger utilities
export {createLogger} from "./utils"
export type {LoggerOptions} from "./utils"

// JSON parsing utilities
export {tryParsePartialJson, safeJson5Parse} from "./utils"

// Key path utilities
export {keyToString, stringToKeyPath} from "./utils"

// JSON detection utilities
export {
    isJsonString,
    isJsonObject,
    isJsonArray,
    tryParseJson,
    tryParseAsObject,
    tryParseAsArray,
    canExpandAsJson,
    tryParseJsonValue,
} from "./utils"
export type {JsonParseResult} from "./utils"

// Editor language detection utilities
export {detectEditorLanguage, getContentLanguage, looksLikeJson, type EditorLanguage} from "./utils"

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
export {useDebounceInput} from "./hooks"

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
} from "./utils"
export type {FormatterOptions, Formatter} from "./utils"

// Pluralization utilities
export {pluralize, formatCount} from "./utils"
