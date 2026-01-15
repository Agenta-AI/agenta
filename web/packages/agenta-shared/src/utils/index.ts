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
