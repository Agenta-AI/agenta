// Span types have a single source of truth: the zod schemas in @agenta/entities,
// which validate the backend payload at the boundary. Import them from
// @agenta/entities/trace directly; this module owns only the OSS-only additions.

import type {TraceSpanNode as EntityTraceSpanNode} from "@agenta/entities/trace"

import type {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"

export interface TraceSpanNode extends EntityTraceSpanNode {
    /** Attached by the trace/session drawer stores when annotation data is loaded */
    annotations?: AnnotationDto[]
}

// AGE-3788: `TracingDashboardData` (the old success/error bucket split returned
// by the deprecated `/tracing/spans/analytics`) was removed. The dashboard now
// reads spec-based metric buckets from `/spans/analytics/query` via the entities
// `AnalyticsResponse` type; `analyticsToGeneration` maps them onto
// `GenerationDashboardData` below.

export interface GenerationDashboardData {
    data: {
        timestamp: number | string
        success_count: number
        failure_count: number
        cost: number
        latency: number
        total_tokens: number
        // The new `/spans/analytics/query` metrics do not split tokens by
        // prompt/completion and carry no environment/variant per bucket. These
        // were never populated by the legacy transform either and are unread by
        // the observability dashboard, so they are optional.
        prompt_tokens?: number
        completion_tokens?: number
        enviornment?: string
        variant?: string
    }[]
    total_count: number
    failure_rate: number
    total_cost: number
    avg_cost: number
    avg_latency: number
    total_tokens: number
    avg_tokens: number
}
