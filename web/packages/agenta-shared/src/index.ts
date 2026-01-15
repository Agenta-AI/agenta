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
