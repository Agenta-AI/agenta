/**
 * Trace Entity Module
 *
 * Manages trace span entities with:
 * - Batch fetching for concurrent requests
 * - Cache redirect from various query caches
 * - Draft state for local edits
 * - Entity controllers for unified API access
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
    // Query atom family (single source of truth for server data)
    spanQueryAtomFamily,
    // Draft state atoms
    traceSpanDraftAtomFamily,
    traceSpanHasDraftAtomFamily,
    traceSpanIsDirtyAtomFamily,
    discardTraceSpanDraftAtom,
    updateTraceSpanAtom,
    // Combined entity atom (server + draft)
    traceSpanEntityAtomFamily,
    // Derived atom families for data extraction
    spanInputsAtomFamily,
    spanOutputsAtomFamily,
    spanAgDataAtomFamily,
    // Trace entity atom family (for trace tree data)
    traceEntityAtomFamily,
    // Cache invalidation
    invalidateTraceEntityCache,
} from "./store"

// Entity API (unified API - recommended for most use cases)
export {
    traceSpan,
    type EntityAction as TraceSpanAction,
    type EntityControllerState as TraceSpanControllerState,
} from "./controller"

// Note: Drill-in helpers are now accessed via traceSpan.drillIn.*
// e.g., traceSpan.drillIn.getValueAtPath, traceSpan.drillIn.getRootItems

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
