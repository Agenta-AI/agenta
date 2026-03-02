import {atomFamily, selectAtom} from "jotai/utils"

import type {TraceData, TraceNode, TraceTree} from "@/oss/lib/evaluations"
import {uuidToTraceId} from "@/oss/lib/traces/helpers"
import {transformTracesResponseToTree} from "@/oss/services/tracing/lib/helpers"
import type {TraceSpanNode, TracesResponse} from "@/oss/services/tracing/types"
import {traceEntityAtomFamily, invalidateTraceEntityCache} from "@/oss/state/entities/trace/store"

import {resolveInvocationTraceValue} from "../utils/traceValue"

/**
 * Invalidate the trace batcher cache.
 * Now delegates to the shared trace entity cache invalidation.
 */
export const invalidateTraceBatcherCache = invalidateTraceEntityCache

const _debugTraceValue = (() => {
    const enabled = process.env.NEXT_PUBLIC_EVAL_RUN_DEBUG === "true"
    const seen = new Set<string>()
    return (message: string, payload: Record<string, unknown>, options?: {onceKey?: string}) => {
        if (!enabled) return

        if (options?.onceKey) {
            if (seen.has(options.onceKey)) return
            seen.add(options.onceKey)
        }

        console.debug(message, payload)
    }
})()

const summarizeShape = (value: unknown): string => {
    if (value === null) return "null"
    if (value === undefined) return "undefined"
    if (typeof value === "string") {
        return value.length > 160 ? `string(${value.slice(0, 160)}…)` : `string(${value})`
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value)
    }
    if (Array.isArray(value)) {
        return `array(len=${value.length})`
    }
    if (typeof value === "object") {
        const keys = Object.keys(value as Record<string, unknown>)
        const preview = keys.slice(0, 10).join(", ")
        const suffix = keys.length > 10 ? "…" : ""
        return `object(keys=[${preview}${suffix}])`
    }
    return typeof value
}

const _summarizeTraceData = (trace: TraceData | null | undefined): Record<string, unknown> => {
    if (!trace) {
        return {state: trace === null ? "null" : "undefined"}
    }

    const firstTree = trace.trees?.[0]
    return {
        version: trace.version,
        count: trace.count,
        treeCount: Array.isArray(trace.trees) ? trace.trees.length : undefined,
        treeId: firstTree?.tree?.id,
        nodes: Array.isArray(firstTree?.nodes) ? firstTree?.nodes.length : undefined,
        nodeShape: summarizeShape(firstTree?.nodes?.[0]),
        dataShape: summarizeShape((firstTree as any)?.data),
    }
}

const loggedRawTraces = new Set<string>()

const toStringOrEmpty = (value: unknown): string => {
    if (value === undefined || value === null) return ""
    return String(value)
}

const convertSpanNodeToTraceNode = (
    span: TraceSpanNode,
    traceId: string,
    flat: TraceNode[],
    parentId?: string,
): TraceNode => {
    const attributes = (span.attributes ?? {}) as Record<string, any>
    const node: TraceNode = {
        trace_id: span.trace_id ?? traceId,
        span_id: span.span_id ?? span.span_name ?? "",
        lifecycle: {
            created_at: toStringOrEmpty((span as any)?.created_at),
        },
        root: {
            id: traceId,
        },
        tree: {
            id: traceId,
        },
        node: {
            id: span.span_id ?? span.span_name ?? "",
            name: span.span_name ?? span.span_id ?? "",
            type: span.span_type ?? span.trace_type ?? "",
        },
        parent: parentId ? {id: parentId} : undefined,
        time: {
            start: toStringOrEmpty(span.start_time),
            end: toStringOrEmpty(span.end_time),
        },
        status: {
            code: span.status_code ?? "",
        },
        data: {
            attributes,
            events: span.events ?? [],
            links: span.links ?? [],
            hashes: span.hashes ?? [],
            references: span.references ?? [],
        },
        metrics: {},
        refs: {},
        otel: {
            kind: span.span_kind ?? "",
            attributes,
        },
    }

    const children = Array.isArray(span.children) ? (span.children as TraceSpanNode[]) : []
    if (children.length) {
        const childMap: Record<string, TraceNode> = {}
        const childList: TraceNode[] = []
        children.forEach((child, index) => {
            const childNode = convertSpanNodeToTraceNode(child, traceId, flat, node.span_id)
            childList.push(childNode)
            const key = childNode.node.id || childNode.span_id || `${node.span_id}-${index}`
            childMap[key] = childNode
        })
        node.nodes = childMap
        ;(node as any).children = childList
    }

    flat.push(node)
    return node
}

const buildTraceDataFromEntry = (
    traceId: string,
    originalTraceId: string,
    traceEntry: {spans: Record<string, any>} | undefined,
    version?: string,
): TraceData | null => {
    if (!traceEntry || !traceEntry.spans || !Object.keys(traceEntry.spans).length) {
        return null
    }

    const scopedResponse: TracesResponse = {
        version,
        count: Object.keys(traceEntry.spans ?? {}).length,
        traces: {
            [traceId]: traceEntry,
        },
    }

    const spanNodes = transformTracesResponseToTree(scopedResponse)
    if (!spanNodes.length) return null

    const flat: TraceNode[] = []
    spanNodes.forEach((span) => {
        const inferredTraceId =
            span.trace_id ?? traceId ?? (span.span_id ? `${span.span_id}-trace` : "trace")
        convertSpanNodeToTraceNode(span, inferredTraceId, flat)
    })

    const treeEntry: TraceTree = {
        tree: {id: originalTraceId},
        nodes: flat,
    }
    ;(treeEntry as any).data = traceEntry

    const traceData: TraceData = {
        version: String(version ?? ""),
        count: flat.length,
        trees: [treeEntry],
    }
    ;(traceData as any).tree = treeEntry

    return traceData
}

/**
 * Transforms raw trace entity response to TraceData format used by evaluation components.
 * This bridges the gap between traceEntityAtomFamily (raw API response) and
 * the TraceData format expected by evaluation atoms.
 */
const transformToTraceData = (
    traceId: string,
    response: {traces?: Record<string, {spans?: Record<string, unknown>}>} | null,
): TraceData | null => {
    if (!response?.traces) return null

    // Find the trace entry - try with and without dashes
    const canonicalId = uuidToTraceId(traceId) ?? traceId.replace(/-/g, "")
    const traceEntry = response.traces[canonicalId] ?? response.traces[traceId]

    if (!traceEntry) return null

    return buildTraceDataFromEntry(canonicalId, traceId, traceEntry as any, undefined)
}

/**
 * Evaluation trace query atom family - uses the shared traceEntityAtomFamily
 * and transforms the response to TraceData format for evaluation components.
 */
export const evaluationTraceQueryAtomFamily = atomFamily(
    ({traceId, runId: _runId}: {traceId: string; runId?: string | null}) =>
        selectAtom(
            traceEntityAtomFamily(traceId),
            (queryState) => {
                const data = queryState.data
                    ? transformToTraceData(traceId, queryState.data as any)
                    : null
                return {
                    data,
                    isLoading: !queryState.data && queryState.isLoading,
                    isFetching: queryState.isFetching,
                    error: queryState.error,
                }
            },
            (a, b) =>
                a.data === b.data &&
                a.isLoading === b.isLoading &&
                a.isFetching === b.isFetching &&
                a.error === b.error,
        ),
)

export const traceValueAtomFamily = atomFamily(
    (args: {traceId: string; path: string; valueKey?: string; runId?: string | null}) =>
        selectAtom(
            evaluationTraceQueryAtomFamily({traceId: args.traceId, runId: args.runId}),
            (queryState) => {
                const resolved = resolveInvocationTraceValue(
                    queryState.data,
                    args.path,
                    args.valueKey,
                )

                if (
                    process.env.NEXT_PUBLIC_EVAL_RUN_DEBUG === "true" &&
                    queryState.data &&
                    !queryState.isLoading
                ) {
                    const rawKey = `${args.traceId}:${args.path}:${args.valueKey ?? ""}`
                    if (!loggedRawTraces.has(rawKey)) {
                        loggedRawTraces.add(rawKey)

                        const _spans = Object.entries(
                            (queryState.data as any)?.tree?.data?.spans ?? {},
                        ).map(([spanId, spanData]: [string, any]) => ({
                            spanId,
                            dataKeys: spanData?.data ? Object.keys(spanData.data) : undefined,
                            attributesKeys: spanData?.data?.attributes
                                ? Object.keys(spanData.data.attributes)
                                : undefined,
                            agKeys: spanData?.data?.attributes?.ag
                                ? Object.keys(spanData.data.attributes.ag)
                                : undefined,
                            outputsPreview: summarizeShape(
                                spanData?.data?.attributes?.ag?.data?.outputs,
                            ),
                        }))
                    }
                }

                return resolved
            },
            Object.is,
        ),
)

export const traceQueryMetaAtomFamily = atomFamily(
    ({traceId, runId}: {traceId: string; runId?: string | null}) =>
        selectAtom(
            evaluationTraceQueryAtomFamily({traceId, runId}),
            (queryState) => {
                // Stale-while-revalidate: only show loading when there's no cached data
                const hasData = Boolean(queryState.data)
                return {
                    isLoading: !hasData && queryState.isLoading,
                    isFetching: queryState.isFetching,
                    error: queryState.error,
                }
            },
            (a, b) =>
                a.isLoading === b.isLoading && a.isFetching === b.isFetching && a.error === b.error,
        ),
)
