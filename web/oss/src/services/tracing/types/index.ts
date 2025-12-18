// --- ENUMS -------------------------------------------------------------------

export enum TraceType {
    INVOCATION = "invocation",
    ANNOTATION = "annotation",
    UNDEFINED = "undefined",
}

export enum SpanCategory {
    AGENT = "agent",
    CHAIN = "chain",
    WORKFLOW = "workflow",
    TASK = "task",
    TOOL = "tool",
    EMBEDDING = "embedding",
    QUERY = "query",
    LLM = "llm",
    COMPLETION = "completion",
    CHAT = "chat",
    RERANK = "rerank",
    UNDEFINED = "undefined",
}

export enum SpanKind {
    SPAN_KIND_UNSPECIFIED = "SPAN_KIND_UNSPECIFIED",
    SPAN_KIND_INTERNAL = "SPAN_KIND_INTERNAL",
    SPAN_KIND_SERVER = "SPAN_KIND_SERVER",
    SPAN_KIND_CLIENT = "SPAN_KIND_CLIENT",
    SPAN_KIND_PRODUCER = "SPAN_KIND_PRODUCER",
    SPAN_KIND_CONSUMER = "SPAN_KIND_CONSUMER",
}

export enum StatusCode {
    STATUS_CODE_UNSET = "STATUS_CODE_UNSET",
    STATUS_CODE_OK = "STATUS_CODE_OK",
    STATUS_CODE_ERROR = "STATUS_CODE_ERROR",
}

// --- SUB-ENTITIES ------------------------------------------------------------

export type SpanAttributes = Record<string, unknown>

export interface SpanEvent {
    name: string
    timestamp: string | number
    attributes?: SpanAttributes
}

export interface SpanLink {
    trace_id: string
    span_id: string
    attributes?: SpanAttributes
}

export interface SpanHash {
    id: string
    attributes?: SpanAttributes
}

export interface SpanReference {
    id?: string
    type?: string
    attributes?: SpanAttributes
}

// --- MAIN SPAN ENTITY --------------------------------------------------------

export interface TraceSpan {
    trace_id: string
    span_id: string
    parent_id?: string

    span_type?: SpanCategory
    trace_type?: TraceType

    span_kind?: SpanKind
    span_name?: string

    start_time?: string | number
    end_time?: string | number

    status_code?: StatusCode
    status_message?: string

    attributes?: SpanAttributes
    references?: SpanReference[]
    links?: SpanLink[]
    hashes?: SpanHash[]
    events?: SpanEvent[]

    created_at?: string
    updated_at?: string
    deleted_at?: string

    created_by_id?: string
    updated_by_id?: string
    deleted_by_id?: string
}

export interface TraceSpanNode extends TraceSpan {
    key?: string
    invocationIds?: {
        trace_id: string
        span_id: string
    }
    children?: TraceSpan[]
}

// --- RESPONSE WRAPPER --------------------------------------------------------

export interface TracesResponse {
    version?: string
    count: number
    traces: Record<string, {spans: Record<string, TraceSpan>}>
}

export interface SpansResponse {
    version?: string
    count: number
    spans: TraceSpan[]
}

export interface TracingDashboardData {
    buckets: {
        errors: {
            costs: number
            count: number
            duration: number
            tokens: number
        }
        timestamp: string
        total: {
            costs: number
            count: number
            duration: number
            tokens: number
        }
        window: number
    }[]
    count: number
    version: string
}

export interface GenerationDashboardData {
    data: {
        timestamp: number | string
        success_count: number
        failure_count: number
        cost: number
        latency: number
        total_tokens: number
        prompt_tokens: number
        completion_tokens: number
        enviornment: string
        variant: string
    }[]
    total_count: number
    failure_rate: number
    total_cost: number
    avg_cost: number
    avg_latency: number
    total_tokens: number
    avg_tokens: number
}
