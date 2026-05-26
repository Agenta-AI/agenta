import {TraceSpanNode} from "@/oss/services/tracing/types"

type TraceSpanNodeWithRawViewFields = TraceSpanNode & {
    spans?: unknown
    aggregatedEvaluatorMetrics?: unknown
}

export const getRawTraceSpanData = (span: TraceSpanNode) => {
    const {
        spans: _spans,
        children: _children,
        key: _key,
        invocationIds: _invocationIds,
        aggregatedEvaluatorMetrics: _aggregatedEvaluatorMetrics,
        ...rawSpan
    } = span as TraceSpanNodeWithRawViewFields

    return rawSpan
}
