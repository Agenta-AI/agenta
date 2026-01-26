/**
 * Trace Entity - Complete trace and span entity management
 *
 * This module provides everything needed for trace and span entities:
 * - **Molecule** - Unified API for state management
 * - Zod schemas for validation
 * - Type guards and helper utilities
 * - API functions for fetching trace data
 * - Selector utilities for data extraction
 *
 * @example
 * ```typescript
 * import { traceSpanMolecule, type TraceSpan } from '@agenta/entities/trace'
 *
 * // Reactive atoms (for useAtomValue, atom compositions)
 * const data = useAtomValue(traceSpanMolecule.atoms.data(spanId))
 * const isDirty = useAtomValue(traceSpanMolecule.atoms.isDirty(spanId))
 * const inputs = useAtomValue(traceSpanMolecule.atoms.inputs(spanId))
 *
 * // Write atoms (for use in other atoms with set())
 * set(traceSpanMolecule.actions.update, spanId, changes)
 * set(traceSpanMolecule.actions.discard, spanId)
 *
 * // Imperative API (for callbacks outside React/atom context)
 * const data = traceSpanMolecule.get.data(spanId)
 * traceSpanMolecule.set.update(spanId, { 'ag.data.inputs': newInputs })
 * ```
 */

// ============================================================================
// MOLECULE (PRIMARY API)
// ============================================================================

/**
 * Trace span molecule - the primary API for trace span entities.
 *
 * Provides a unified, self-contained API with:
 * - atoms.* - Fine-grained atom families (data, serverData, draft, isDirty, inputs, outputs, agData)
 * - selectors.* - Alias for atoms (EntityDrillInView compatibility)
 * - controller(id) - State + dispatch atom (EntityDrillInView compatibility)
 * - reducers.* - Write atoms for mutations (update, discard)
 * - drillIn.* - Path navigation utilities for EntityDrillInView
 * - get.* / set.* - Imperative API for callbacks
 * - useController(id) - React hook returning [state, dispatch]
 * - cleanup.* - Memory management utilities
 * - lifecycle.* - Mount/unmount event subscriptions (inspired by bunshi)
 * - getAgDataPath(span) - Helper to find ag.data path in span attributes
 */
export {traceSpanMolecule, type TraceSpanMolecule} from "./state"

// ============================================================================
// SCHEMAS & TYPES
// ============================================================================

// Zod schemas and types
export {
    // Enums
    TraceTypeEnum,
    type TraceType,
    SpanCategoryEnum,
    type SpanCategory,
    SpanKindEnum,
    type SpanKind,
    StatusCodeEnum,
    type StatusCode,
    // Sub-entity schemas
    spanAttributesSchema,
    type SpanAttributes,
    spanEventSchema,
    type SpanEvent,
    spanLinkSchema,
    type SpanLink,
    spanHashSchema,
    type SpanHash,
    spanReferenceSchema,
    type SpanReference,
    // Main schemas
    traceSpanSchema,
    type TraceSpan,
    traceSpanNodeSchema,
    type TraceSpanNode,
    // Response wrappers
    tracesResponseSchema,
    type TracesResponse,
    spansResponseSchema,
    type SpansResponse,
    type TraceListResponse,
} from "./core"

// Type definitions
export type {
    TraceListParams,
    TraceDetailParams,
    SpanRequest,
    TraceRequest,
    TracesApiResponse,
} from "./core"

// ============================================================================
// API & HELPERS
// ============================================================================

// API functions
export {
    fetchAllPreviewTraces,
    fetchPreviewTrace,
    deletePreviewTrace,
    fetchSessions,
    type TraceQueryParams,
    type SessionQueryParams,
} from "./api"

// Helper utilities
export {
    isTracesResponse,
    isSpansResponse,
    sortSpansByStartTime,
    transformTracesResponseToTree,
    transformTracingResponse,
} from "./api"

// ============================================================================
// SELECTORS (PURE UTILITIES)
// ============================================================================

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
} from "./utils"

// ============================================================================
// TRACE-LEVEL UTILITIES
// ============================================================================

/**
 * Trace-level query atoms and utilities.
 *
 * These are for fetching ENTIRE TRACES (with all spans), not individual spans.
 * For span-level operations with draft state, use traceSpanMolecule.
 *
 * @example
 * ```typescript
 * // Fetch entire trace tree for display (read-only)
 * const traceQuery = useAtomValue(traceEntityAtomFamily(traceId))
 * const { data: traceData, isPending } = traceQuery
 *
 * // Invalidate trace cache after mutations
 * invalidateTraceEntityCache(traceId)
 * ```
 */
export {
    // Trace-level query atom (for fetching entire traces with all spans)
    traceEntityAtomFamily,
    // Cache invalidation utility
    invalidateTraceEntityCache,
    // Error classes
    SpanNotFoundError,
    TraceNotFoundError,
} from "./state"
