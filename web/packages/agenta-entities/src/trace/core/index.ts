/**
 * Core Types and Schemas
 *
 * Exports Zod schemas and TypeScript types for trace/span entities.
 * These have no dependencies on other modules.
 */

// Zod schemas and types
export {
    // Enums
    TraceTypeEnum,
    type TraceType,
    SpanCategoryEnum,
    type SpanCategory,
    SpanKindEnum,
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
    type TraceSpanNode,
    // Response wrappers
    tracesResponseSchema,
    type TracesResponse,
    spansResponseSchema,
    type SpansResponse,
    // New envelope schemas (AGE-3788)
    traceOutputSchema,
    type TraceOutput,
    traceResponseSchema,
    type TraceResponse,
    tracesArrayResponseSchema,
    windowingSchema,
    type Windowing,
    sessionIdsResponseSchema,
    type SessionIdsResponse,
    traceIdResponseSchema,
    type TraceIdResponse,
    metricsBucketSchema,
    type MetricsBucket,
    analyticsResponseSchema,
    type AnalyticsResponse,
    // Parsing utilities
    parseTraceSpan,
    parseTracesResponse,
} from "./schema"

// Type definitions
export type {
    TraceListParams,
    TraceDetailParams,
    SpanRequest,
    TraceRequest,
    TracesApiResponse,
} from "./types"
