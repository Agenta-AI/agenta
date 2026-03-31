/**
 * Trace Entity Schemas
 *
 * Zod schemas for validation and type safety of trace/span entities.
 * Traces are read-only entities (no local creation), so we use the common
 * field schemas for consistency but don't need createEntitySchemaSet.
 *
 * @example
 * ```typescript
 * import {
 *     traceSpanSchema,
 *     TraceSpan,
 *     SpanCategoryEnum,
 * } from '@agenta/entities/trace'
 *
 * // Parse API response
 * const span = traceSpanSchema.parse(apiResponse)
 * ```
 */

import {z} from "zod"

import {timestampFieldsSchema, auditFieldsSchema, safeParseWithLogging} from "../../shared"

// --- ENUMS -------------------------------------------------------------------

export const TraceTypeEnum = z.enum(["invocation", "annotation", "undefined"])
export type TraceType = z.infer<typeof TraceTypeEnum>

export const SpanCategoryEnum = z.enum([
    "agent",
    "chain",
    "workflow",
    "task",
    "tool",
    "embedding",
    "query",
    "llm",
    "completion",
    "chat",
    "rerank",
    "undefined",
])
export type SpanCategory = z.infer<typeof SpanCategoryEnum>

export const SpanKindEnum = z.enum([
    "SPAN_KIND_UNSPECIFIED",
    "SPAN_KIND_INTERNAL",
    "SPAN_KIND_SERVER",
    "SPAN_KIND_CLIENT",
    "SPAN_KIND_PRODUCER",
    "SPAN_KIND_CONSUMER",
])
export type SpanKind = z.infer<typeof SpanKindEnum>

export const StatusCodeEnum = z.enum(["STATUS_CODE_UNSET", "STATUS_CODE_OK", "STATUS_CODE_ERROR"])
export type StatusCode = z.infer<typeof StatusCodeEnum>

// --- SUB-ENTITIES ------------------------------------------------------------

export const spanAttributesSchema = z.record(z.string(), z.unknown())
export type SpanAttributes = z.infer<typeof spanAttributesSchema>

export const spanEventSchema = z.object({
    name: z.string(),
    timestamp: z.union([z.string(), z.number()]),
    attributes: spanAttributesSchema.optional(),
})
export type SpanEvent = z.infer<typeof spanEventSchema>

export const spanLinkSchema = z.object({
    trace_id: z.string(),
    span_id: z.string(),
    attributes: spanAttributesSchema.optional(),
})
export type SpanLink = z.infer<typeof spanLinkSchema>

export const spanHashSchema = z.object({
    id: z.string(),
    attributes: spanAttributesSchema.optional(),
})
export type SpanHash = z.infer<typeof spanHashSchema>

export const spanReferenceSchema = z.object({
    id: z.string().optional(),
    type: z.string().optional(),
    attributes: spanAttributesSchema.optional(),
})
export type SpanReference = z.infer<typeof spanReferenceSchema>

// --- MAIN SPAN ENTITY --------------------------------------------------------

// Type for TraceSpan (defined first for recursive schema)
export interface TraceSpan {
    trace_id: string
    span_id: string
    parent_id?: string | null

    span_type?: z.infer<typeof SpanCategoryEnum> | null
    trace_type?: z.infer<typeof TraceTypeEnum> | null

    span_kind?: z.infer<typeof SpanKindEnum> | null
    span_name?: string | null

    start_time?: string | number | null
    end_time?: string | number | null

    status_code?: z.infer<typeof StatusCodeEnum> | null
    status_message?: string | null

    attributes?: SpanAttributes | null
    references?: SpanReference[] | null
    links?: SpanLink[] | null
    hashes?: SpanHash[] | null
    events?: SpanEvent[] | null

    created_at?: string | null
    updated_at?: string | null
    deleted_at?: string | null

    created_by_id?: string | null
    updated_by_id?: string | null
    deleted_by_id?: string | null

    // Nested child spans (recursive)
    spans?: Record<string, TraceSpan> | null
}

/**
 * Base span fields schema (non-recursive part)
 * Uses common timestamp and audit field schemas for consistency
 */
const baseSpanFieldsSchema = z.object({
    trace_id: z.string(),
    span_id: z.string(),
    parent_id: z.string().optional().nullable(),

    span_type: SpanCategoryEnum.optional().nullable(),
    trace_type: TraceTypeEnum.optional().nullable(),

    span_kind: SpanKindEnum.optional().nullable(),
    span_name: z.string().optional().nullable(),

    start_time: z.union([z.string(), z.number()]).optional().nullable(),
    end_time: z.union([z.string(), z.number()]).optional().nullable(),

    status_code: StatusCodeEnum.optional().nullable(),
    status_message: z.string().optional().nullable(),

    attributes: spanAttributesSchema.optional().nullable(),
    references: z.array(spanReferenceSchema).optional().nullable(),
    links: z.array(spanLinkSchema).optional().nullable(),
    hashes: z.array(spanHashSchema).optional().nullable(),
    events: z.array(spanEventSchema).optional().nullable(),
})

// Recursive span schema using common field schemas
export const traceSpanSchema: z.ZodType<TraceSpan> = z.lazy(() =>
    baseSpanFieldsSchema
        .merge(timestampFieldsSchema)
        .merge(auditFieldsSchema)
        .extend({
            // Nested child spans
            spans: z.record(z.string(), traceSpanSchema).optional().nullable(),
        }),
)

// Extended span with tree structure
export interface TraceSpanNode extends TraceSpan {
    key?: string
    invocationIds?: {
        trace_id: string
        span_id: string
    } | null
    children?: TraceSpan[] | null
}

export const traceSpanNodeSchema: z.ZodType<TraceSpanNode> = z.lazy(() =>
    baseSpanFieldsSchema
        .merge(timestampFieldsSchema)
        .merge(auditFieldsSchema)
        .extend({
            spans: z.record(z.string(), traceSpanSchema).optional().nullable(),
            key: z.string().optional(),
            invocationIds: z
                .object({
                    trace_id: z.string(),
                    span_id: z.string(),
                })
                .optional()
                .nullable(),
            children: z.array(traceSpanSchema).optional().nullable(),
        }),
)

// --- RESPONSE WRAPPERS -------------------------------------------------------

export const tracesResponseSchema = z.object({
    version: z.string().optional(),
    count: z.number(),
    traces: z.record(
        z.string(),
        z.object({
            spans: z.record(z.string(), traceSpanSchema),
        }),
    ),
})
export type TracesResponse = z.infer<typeof tracesResponseSchema>

export const spansResponseSchema = z.object({
    version: z.string().optional(),
    count: z.number(),
    spans: z.array(traceSpanSchema),
})
export type SpansResponse = z.infer<typeof spansResponseSchema>

// Combined response type for list queries
export interface TraceListResponse {
    traces: TraceSpanNode[]
    count: number
    nextCursor?: string
}

// ============================================================================
// PARSING UTILITIES
// ============================================================================

/**
 * Safely parse a trace span with logging
 *
 * @example
 * ```typescript
 * const span = parseTraceSpan(apiResponse)
 * if (span) {
 *   // Use validated span
 * }
 * ```
 */
export function parseTraceSpan(data: unknown): TraceSpan | null {
    return safeParseWithLogging(traceSpanSchema, data, "[parseTraceSpan]")
}

/**
 * Safely parse a traces response with logging
 */
export function parseTracesResponse(data: unknown): TracesResponse | null {
    return safeParseWithLogging(tracesResponseSchema, data, "[parseTracesResponse]")
}
