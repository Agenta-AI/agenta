import {z} from "zod"

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

export const traceSpanSchema = z.object({
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

    created_at: z.string().optional().nullable(),
    updated_at: z.string().optional().nullable(),
    deleted_at: z.string().optional().nullable(),

    created_by_id: z.string().optional().nullable(),
    updated_by_id: z.string().optional().nullable(),
    deleted_by_id: z.string().optional().nullable(),
})
export type TraceSpan = z.infer<typeof traceSpanSchema>

// Extended span with tree structure
export const traceSpanNodeSchema = traceSpanSchema.extend({
    key: z.string().optional(),
    invocationIds: z
        .object({
            trace_id: z.string(),
            span_id: z.string(),
        })
        .optional()
        .nullable(),
    children: z
        .array(z.lazy(() => traceSpanSchema))
        .optional()
        .nullable(),
})
export type TraceSpanNode = z.infer<typeof traceSpanNodeSchema>

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
