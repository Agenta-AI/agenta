import type {Key} from "react"

import type {TraceSpanNode} from "@agenta/entities/trace"

import {getNodeById} from "@/oss/lib/traces/observability_helpers"
import type {TraceSpanNode as OssTraceSpanNode} from "@/oss/services/tracing/types"

export interface TraceIdFilter {
    operator: "and"
    conditions: [{field: "trace_id"; operator: "in"; value: string[]}]
}

export const buildTraceIdFilter = (ids: string[]): TraceIdFilter => ({
    operator: "and",
    conditions: [{field: "trace_id", operator: "in", value: ids}],
})

/**
 * Stamped on queries created by "run evaluation from traces" so the Query
 * Registry can tell apart queries born from a trace-evaluation run from ones the
 * user authored by hand. Stored under `meta.source`; read back via the same key.
 */
export const TRACE_EVALUATION_QUERY_SOURCE = "trace_evaluation"

export const buildTraceEvaluationQueryName = (evaluationName: string): string => {
    const trimmedName = evaluationName.trim()
    return trimmedName || "Trace evaluation source"
}

export const rootKeysForTraceIds = (traces: TraceSpanNode[], ids: string[]): Key[] => {
    const selectedTraceIds = new Set(ids)
    return traces
        .filter((trace) => trace.trace_id && selectedTraceIds.has(trace.trace_id))
        .map((trace) => trace.span_id || trace.key)
        .filter((key): key is string => Boolean(key))
}

export const selectedKeysToTraceIds = (traces: TraceSpanNode[], keys: Key[]): string[] =>
    Array.from(
        new Set(
            keys
                .map(
                    (key) =>
                        getNodeById(traces as unknown as OssTraceSpanNode[], String(key))?.trace_id,
                )
                .filter((traceId): traceId is string => Boolean(traceId)),
        ),
    )
