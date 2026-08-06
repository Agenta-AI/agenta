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
    extractInternals,
    extractAgData,
    spanToTraceData,
    extractTestsetData,
    // Batch operations
    collectPathsFromSpans,
    collectDataPathsFromSpans,
    pathsToSelectOptions,
    // Auto-mapping
    COLUMN_NAME_MAPPINGS,
    getSuggestedColumnName,
    generateMappingSuggestions,
    matchColumnsWithSuggestions,
} from "./selectors"
