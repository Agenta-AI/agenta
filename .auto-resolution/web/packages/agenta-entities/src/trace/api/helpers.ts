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

import type {SpansResponse, TracesResponse, TraceSpanNode, TraceSpan} from "../core"

/**
 * Type guard for TracesResponse (response with traces object)
 */
export const isTracesResponse = (data: unknown): data is TracesResponse => {
    return typeof data === "object" && data !== null && "traces" in data
}

/**
 * Type guard for SpansResponse (response with spans array)
 */
export const isSpansResponse = (data: unknown): data is SpansResponse => {
    return typeof data === "object" && data !== null && "spans" in data
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
 * Transform a TracesResponse into a tree of TraceSpanNodes.
 *
 * @param data - TracesResponse from the API
 * @returns Array of TraceSpanNode trees
 */
export const transformTracesResponseToTree = (data: TracesResponse): TraceSpanNode[] => {
    const buildTree = (spans: Record<string, unknown> | unknown[]): TraceSpanNode[] => {
        if (!spans) {
            return []
        }

        const spanArray = Object.values(spans).flatMap((span: unknown) => {
            if (Array.isArray(span)) {
                return buildTree(span)
            }

            const spanObj = span as TraceSpan & {spans?: Record<string, unknown>}
            const node: TraceSpanNode = {
                ...spanObj,
            }

            if (spanObj?.spans && Object.keys(spanObj.spans).length > 0) {
                node.children = buildTree(spanObj.spans)
            }

            return node
        })

        // Sort spans at this hierarchy level by start_time
        return sortSpansByStartTime(spanArray)
    }

    return Object.values(data.traces).flatMap((trace: {spans?: Record<string, unknown>}) =>
        buildTree(trace.spans || {}),
    )
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
