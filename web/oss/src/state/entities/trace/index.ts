/**
 * Trace Entity Module
 *
 * Manages trace span entities with:
 * - Batch fetching for concurrent requests
 * - Cache redirect from various query caches
 * - Draft state for local edits
 * - Stateful atoms for simplified entity access
 * - Drill-in navigation for nested data
 */

// Schema and types
export {
    TraceTypeEnum,
    SpanCategoryEnum,
    SpanKindEnum,
    StatusCodeEnum,
    spanAttributesSchema,
    spanEventSchema,
    spanLinkSchema,
    spanHashSchema,
    spanReferenceSchema,
    traceSpanSchema,
    traceSpanNodeSchema,
    tracesResponseSchema,
    spansResponseSchema,
    type TraceType,
    type SpanCategory,
    type SpanKind,
    type StatusCode,
    type SpanAttributes,
    type SpanEvent,
    type SpanLink,
    type SpanHash,
    type SpanReference,
    type TraceSpan,
    type TraceSpanNode,
    type TracesResponse,
    type SpansResponse,
    type TraceListResponse,
} from "./schema"

// Store and atoms
export {
    // Params types
    type TraceListParams,
    type TraceDetailParams,
    // Query atom family
    spanQueryAtomFamily,
    // Server state (raw data without draft)
    traceSpanServerStateAtomFamily,
    // Draft state atoms
    traceSpanDraftAtomFamily,
    traceSpanHasDraftAtomFamily,
    traceSpanIsDirtyAtomFamily,
    discardTraceSpanDraftAtom,
    updateTraceSpanAtom,
    // Combined entity atom (server + draft)
    traceSpanEntityAtomFamily,
    // Backward compatibility alias
    traceSpanAtomFamily,
    // Derived atom families for data extraction
    spanInputsAtomFamily,
    spanOutputsAtomFamily,
    spanAgDataAtomFamily,
    // Trace entity atom family (for trace tree data)
    traceEntityAtomFamily,
    // Cache invalidation
    invalidateTraceEntityCache,
} from "./store"

// Stateful atoms (combined entity + query state)
export {traceSpanStatefulAtomFamily} from "./statefulAtoms"

// Drill-in state (path-based navigation and editing)
export {
    // Backward compatibility alias
    traceSpanWithDraftAtomFamily,
    // Drill-in helpers
    getTraceSpanValueAtPath,
    getTraceSpanRootItems,
    traceSpanSetValueAtPathAtom,
} from "./drillInState"

// Selectors and helpers
export {
    // Path constants
    TRACE_DATA_PATHS,
    // Path utilities
    getValueAtPath,
    collectKeyPaths,
    filterDataPaths,
    getColumnNameFromPath,
    // Data extraction
    extractInputs,
    extractOutputs,
    extractInternals,
    extractAgData,
    extractTestsetData,
    spanToTraceData,
    // Batch operations
    collectPathsFromSpans,
    collectDataPathsFromSpans,
    pathsToSelectOptions,
    // Auto-mapping helpers
    COLUMN_NAME_MAPPINGS,
    getSuggestedColumnName,
    generateMappingSuggestions,
    matchColumnsWithSuggestions,
} from "./selectors"
