/**
 * Trace Entity Helpers
 *
 * This module provides type guards and utility functions for working with
 * trace and span data.
 *
 * @example
 * ```typescript
 * import {
 *   isTracesResponse,
 *   isSpansResponse,
 *   sortSpansByStartTime,
 *   transformTracesResponseToTree
 * } from '@agenta/entities/trace'
 * ```
 */

import type {
    SpansResponse,
    TraceResponse,
    TracesResponse,
    TraceSpanNode,
    TraceSpan,
} from "../core"

/**
 * Type guard for TracesResponse (legacy response with traces record object).
 */
export const isTracesResponse = (data: unknown): data is TracesResponse => {
    return typeof data === "object" && data !== null && "traces" in data
}

/**
 * Type guard for SpansResponse (response with flat spans array).
 */
export const isSpansResponse = (data: unknown): data is SpansResponse => {
    return typeof data === "object" && data !== null && "spans" in data && Array.isArray((data as any).spans)
}

/**
 * Type guard for TraceResponse (new single-trace response from GET /traces/{id}).
 */
export const isTraceResponse = (data: unknown): data is TraceResponse => {
    return typeof data === "object" && data !== null && "trace" in data
}

/**
 * Sorts an array of spans by their start_time in ascending order (earliest first).
 *
 * This function ensures hierarchical tree structures display spans in chronological order.
 * It only sorts spans at the same level - parent/child relationships are maintained.
 *
 * Sorting logic:
 * - Primary: start_time (ascending - earliest first)
 * - Secondary: span_id (for concurrent spans with identical start times)
 * - Spans without start_time are placed at the end
 *
 * @param spans - Array of spans to sort
 * @returns New sorted array (does not mutate input)
 */
export const sortSpansByStartTime = <
    T extends {start_time?: string | number | null; span_id?: string},
>(
    spans: T[],
): T[] => {
    return [...spans].sort((a, b) => {
        const aTime = a.start_time
        const bTime = b.start_time

        // Handle missing start_time - push to end
        if (!aTime && !bTime) return 0
        if (!aTime) return 1
        if (!bTime) return -1

        // Convert to milliseconds for comparison
        const aMs = typeof aTime === "number" ? aTime : new Date(aTime).getTime()
        const bMs = typeof bTime === "number" ? bTime : new Date(bTime).getTime()

        // Primary sort: by start_time
        if (aMs !== bMs) {
            return aMs - bMs
        }

        // Secondary sort: by span_id for concurrent spans
        const aId = a.span_id || ""
        const bId = b.span_id || ""
        return aId.localeCompare(bId)
    })
}

/**
 * Build a tree of TraceSpanNodes from a spans record.
 *
 * Shared by both the legacy `TracesResponse` path and the new `TraceResponse`
 * path — the inner span structure is identical.
 */
const buildSpanTree = (spans: Record<string, unknown> | unknown[]): TraceSpanNode[] => {
    if (!spans) {
        return []
    }

    const spanArray = Object.values(spans).flatMap((span: unknown) => {
        if (Array.isArray(span)) {
            return buildSpanTree(span)
        }

        const spanObj = span as TraceSpan & {spans?: Record<string, unknown>}
        const node: TraceSpanNode = {
            ...spanObj,
        }

        if (spanObj?.spans && Object.keys(spanObj.spans).length > 0) {
            node.children = buildSpanTree(spanObj.spans)
        }

        return node
    })

    return sortSpansByStartTime(spanArray)
}

/**
 * Transform a TracesResponse (legacy, with `traces` record) into a tree.
 *
 * @param data - TracesResponse from the API
 * @returns Array of TraceSpanNode trees
 */
export const transformTracesResponseToTree = (data: TracesResponse): TraceSpanNode[] => {
    return Object.values(data.traces).flatMap((trace: {spans?: Record<string, unknown>}) =>
        buildSpanTree(trace.spans || {}),
    )
}

/**
 * Transform a TraceResponse (new single-trace from GET /traces/{id}) into a tree.
 *
 * @param data - TraceResponse from the API
 * @returns Array of TraceSpanNode trees (single trace)
 */
export const transformTraceResponseToTree = (data: TraceResponse): TraceSpanNode[] => {
    if (!data.trace?.spans) return []
    return buildSpanTree(data.trace.spans)
}

/**
 * Enhance trace span nodes with key and invocationIds for tree rendering.
 *
 * @param data - Array of TraceSpanNodes
 * @returns Enhanced array with key and invocationIds
 */
export const transformTracingResponse = (data: TraceSpanNode[]): TraceSpanNode[] => {
    const enhance = (span: TraceSpanNode): TraceSpanNode => ({
        ...span,
        key: span.span_id,
        invocationIds: {
            trace_id: span.trace_id,
            span_id: span.span_id,
        },
        children: span.children?.map(enhance),
    })

    return data.map(enhance)
}
