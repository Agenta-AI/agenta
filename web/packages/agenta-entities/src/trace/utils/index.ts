/**
 * Utility Functions
 *
 * Exports pure data extraction and manipulation utilities.
 */

export {
    // Path extraction
    TRACE_DATA_PATHS,
    getValueAtPath,
    collectKeyPaths,
    filterDataPaths,
    getColumnNameFromPath,
    // Span data extraction
    extractInputs,
    extractOutputs,
    extractAgData,
    // Batch operations
    collectPathsFromSpans,
    // Auto-mapping
    COLUMN_NAME_MAPPINGS,
    getSuggestedColumnName,
    matchColumnsWithSuggestions,
} from "./selectors"

export {getNodeById} from "./nodeTree"
