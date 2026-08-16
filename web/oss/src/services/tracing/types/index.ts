// Span types live in @agenta/entities/trace; this module adds only OSS extras.

import type {TraceSpanNode as EntityTraceSpanNode} from "@agenta/entities/trace"

import type {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"

export interface TraceSpanNode extends EntityTraceSpanNode {
    /** Attached by the trace/session drawer stores when annotation data is loaded */
    annotations?: AnnotationDto[]
}

// Import `DashboardData` from @agenta/observability.
