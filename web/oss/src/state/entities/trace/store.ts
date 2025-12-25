import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {fetchAllPreviewTraces} from "@/oss/services/tracing/api"
import {
    isSpansResponse,
    isTracesResponse,
    transformTracesResponseToTree,
    transformTracingResponse,
} from "@/oss/services/tracing/lib/helpers"

import {traceSpanSchema, type TraceSpan, type TraceSpanNode, type TraceListResponse} from "./schema"
import {extractAgData, extractInputs, extractOutputs} from "./selectors"

// ============================================================================
// PARAMS TYPES
// ============================================================================

export interface TraceListParams {
    projectId: string
    appId?: string | null
    focus?: "trace" | "span" | "chat"
    size?: number
    oldest?: string
    newest?: string
    filter?: string
}

export interface TraceDetailParams {
    traceId: string
    spanId?: string
    projectId: string
}

// ============================================================================
// NORMALIZED CACHE
// ============================================================================

/**
 * Normalized cache for trace spans indexed by span_id
 * This allows O(1) lookup of any span by its ID
 */
export const traceSpanCacheAtom = atom<Map<string, TraceSpan>>(new Map())

/**
 * Atom family for accessing individual spans from the cache
 */
export const traceSpanAtomFamily = atomFamily((spanId: string) =>
    atom((get) => {
        const cache = get(traceSpanCacheAtom)
        return cache.get(spanId) ?? null
    }),
)

/**
 * Atom family for accessing spans by trace_id (returns all spans in a trace)
 */
export const spansByTraceIdAtomFamily = atomFamily((traceId: string) =>
    atom((get) => {
        const cache = get(traceSpanCacheAtom)
        const spans: TraceSpan[] = []
        cache.forEach((span) => {
            if (span.trace_id === traceId) {
                spans.push(span)
            }
        })
        return spans
    }),
)

// ============================================================================
// CACHE OPERATIONS
// ============================================================================

/**
 * Upsert a single span into the cache
 */
export const upsertSpanAtom = atom(null, (get, set, span: TraceSpan) => {
    const cache = new Map(get(traceSpanCacheAtom))
    cache.set(span.span_id, span)
    set(traceSpanCacheAtom, cache)
})

/**
 * Upsert multiple spans into the cache
 */
export const upsertManySpansAtom = atom(null, (get, set, spans: TraceSpan[]) => {
    const cache = new Map(get(traceSpanCacheAtom))
    spans.forEach((span) => {
        cache.set(span.span_id, span)
    })
    set(traceSpanCacheAtom, cache)
})

/**
 * Remove a span from the cache
 */
export const removeSpanAtom = atom(null, (get, set, spanId: string) => {
    const cache = new Map(get(traceSpanCacheAtom))
    cache.delete(spanId)
    set(traceSpanCacheAtom, cache)
})

/**
 * Clear all spans from the cache
 */
export const clearSpanCacheAtom = atom(null, (_get, set) => {
    set(traceSpanCacheAtom, new Map())
})

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Fetch traces/spans list with optional filters
 */
export async function fetchTracesList(params: TraceListParams): Promise<TraceListResponse> {
    const {
        projectId: _projectId,
        appId,
        focus = "trace",
        size = 50,
        oldest,
        newest,
        filter,
    } = params

    const queryParams: Record<string, any> = {
        size,
        focus,
    }

    if (oldest) queryParams.oldest = oldest
    if (newest) queryParams.newest = newest
    if (filter) queryParams.filter = filter

    const data = await fetchAllPreviewTraces(queryParams, appId ?? "")

    // Transform response to tree structure
    const transformed: TraceSpanNode[] = []
    if (isTracesResponse(data)) {
        transformed.push(...transformTracingResponse(transformTracesResponseToTree(data)))
    } else if (isSpansResponse(data)) {
        transformed.push(...transformTracingResponse(data.spans))
    }

    // Calculate next cursor from earliest timestamp
    let nextCursor: string | undefined
    const getTs = (n: any) =>
        n?.start_time ?? n?.startTime ?? n?.timestamp ?? n?.ts ?? n?.created_at ?? null

    const times = transformed
        .map(getTs)
        .map((value) => {
            if (typeof value === "number") return value
            const parsed = typeof value === "string" ? Date.parse(value) : NaN
            return Number.isNaN(parsed) ? null : parsed
        })
        .filter((value): value is number => value !== null)

    if (times.length) {
        const minVal = times.reduce((min, cur) => (cur < min ? cur : min))
        const cursorDate = new Date(minVal)
        const lowerBound = oldest ? Date.parse(oldest) : undefined

        if (!Number.isNaN(cursorDate.getTime())) {
            if (lowerBound !== undefined && minVal <= lowerBound) {
                nextCursor = undefined
            } else {
                nextCursor = cursorDate.toISOString()
            }
        }
    }

    return {
        traces: transformed,
        count: (data as any)?.count ?? 0,
        nextCursor,
    }
}

/**
 * Fetch a single span by trace_id and span_id
 */
export async function fetchSpanDetail(params: TraceDetailParams): Promise<TraceSpan | null> {
    const {traceId, spanId, projectId: _projectId} = params

    if (!spanId) return null

    // Fetch the trace containing this span
    const queryParams: Record<string, any> = {
        size: 1,
        focus: "span",
        filter: JSON.stringify({
            conditions: [
                {field: "trace_id", operator: "is", value: traceId},
                {field: "span_id", operator: "is", value: spanId},
            ],
        }),
    }

    const data = await fetchAllPreviewTraces(queryParams, "")

    if (isSpansResponse(data) && data.spans.length > 0) {
        return traceSpanSchema.parse(data.spans[0])
    }

    return null
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extract all spans from a tree structure (flattens nested children)
 */
export function flattenTraceTree(nodes: TraceSpanNode[]): TraceSpan[] {
    const spans: TraceSpan[] = []

    const visit = (node: TraceSpanNode) => {
        // Extract the span data (without children)
        const {children, key, invocationIds, ...spanData} = node
        spans.push(spanData as TraceSpan)

        // Recursively visit children
        if (children && Array.isArray(children)) {
            children.forEach((child) => visit(child as TraceSpanNode))
        }
    }

    nodes.forEach(visit)
    return spans
}

/**
 * Hydrate the cache from a list of trace nodes
 */
export const hydrateSpanCacheAtom = atom(null, (get, set, nodes: TraceSpanNode[]) => {
    const spans = flattenTraceTree(nodes)
    set(upsertManySpansAtom, spans)
})

// ============================================================================
// DERIVED ATOM FAMILIES FOR SPAN DATA EXTRACTION
// ============================================================================

/**
 * Atom family to extract inputs from a span by ID
 * Usage: const inputs = useAtomValue(spanInputsAtomFamily(spanId))
 */
export const spanInputsAtomFamily = atomFamily((spanId: string) =>
    atom((get) => {
        const span = get(traceSpanAtomFamily(spanId))
        return extractInputs(span)
    }),
)

/**
 * Atom family to extract outputs from a span by ID
 * Usage: const outputs = useAtomValue(spanOutputsAtomFamily(spanId))
 */
export const spanOutputsAtomFamily = atomFamily((spanId: string) =>
    atom((get) => {
        const span = get(traceSpanAtomFamily(spanId))
        return extractOutputs(span)
    }),
)

/**
 * Atom family to extract all ag.data from a span by ID
 * Usage: const agData = useAtomValue(spanAgDataAtomFamily(spanId))
 */
export const spanAgDataAtomFamily = atomFamily((spanId: string) =>
    atom((get) => {
        const span = get(traceSpanAtomFamily(spanId))
        return extractAgData(span)
    }),
)
