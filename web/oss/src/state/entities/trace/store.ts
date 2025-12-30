import {atom, getDefaultStore} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery, queryClientAtom} from "jotai-tanstack-query"

import {fetchAllPreviewTraces} from "@/oss/services/tracing/api"
import {
    isSpansResponse,
    isTracesResponse,
    transformTracesResponseToTree,
    transformTracingResponse,
} from "@/oss/services/tracing/lib/helpers"
import {projectIdAtom} from "@/oss/state/project/selectors/project"
import createBatchFetcher from "@/oss/state/utils/createBatchFetcher"

import {traceSpanSchema, type TraceSpan, type TraceSpanNode, type TraceListResponse} from "./schema"
import {extractAgData, extractInputs, extractOutputs} from "./selectors"

/**
 * Invalidate the trace entity cache.
 * Call this after running an invocation to force a fresh fetch of trace data.
 */
export const invalidateTraceEntityCache = () => {
    const store = getDefaultStore()
    const queryClient = store.get(queryClientAtom)
    queryClient.invalidateQueries({queryKey: ["trace-entity"]})
}

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
// BATCH FETCHER FOR SPANS
// Collects concurrent single-span requests and batches them
// ============================================================================

interface SpanRequest {
    projectId: string
    spanId: string
    traceId?: string
}

/**
 * Batch fetcher that combines concurrent span requests into a single API call
 * Groups by projectId and fetches all spans in a single query
 */
const spanBatchFetcher = createBatchFetcher<
    SpanRequest,
    TraceSpan | null,
    Map<string, TraceSpan | null>
>({
    serializeKey: ({projectId, spanId}) => `${projectId}:${spanId}`,
    batchFn: async (requests, serializedKeys) => {
        const results = new Map<string, TraceSpan | null>()

        // Group by projectId
        const byProject = new Map<string, {spanIds: string[]; keys: string[]}>()
        requests.forEach((req, idx) => {
            const key = serializedKeys[idx]
            // Skip invalid requests
            if (!req.projectId || !req.spanId) {
                results.set(key, null)
                return
            }
            const existing = byProject.get(req.projectId)
            if (existing) {
                existing.spanIds.push(req.spanId)
                existing.keys.push(key)
            } else {
                byProject.set(req.projectId, {spanIds: [req.spanId], keys: [key]})
            }
        })

        // Fetch each project's spans in batch
        await Promise.all(
            Array.from(byProject.entries()).map(async ([projectId, {spanIds, keys}]) => {
                try {
                    // Build filter for span_ids
                    const filter = {
                        conditions: spanIds.map((spanId) => ({
                            field: "span_id",
                            operator: "is",
                            value: spanId,
                        })),
                    }

                    const data = await fetchAllPreviewTraces(
                        {
                            size: spanIds.length,
                            focus: "span",
                            filter: JSON.stringify(filter),
                        },
                        "", // appId not needed for span lookup
                    )

                    // Parse response
                    const spans: TraceSpan[] = []
                    if (isSpansResponse(data)) {
                        spans.push(...data.spans.map((s) => traceSpanSchema.parse(s)))
                    }

                    // Map results by span_id
                    const byId = new Map<string, TraceSpan>()
                    spans.forEach((span) => {
                        byId.set(span.span_id, span)
                    })

                    // Resolve each request
                    spanIds.forEach((spanId, idx) => {
                        const key = keys[idx]
                        results.set(key, byId.get(spanId) ?? null)
                    })
                } catch (error) {
                    console.error(
                        `[spanBatchFetcher] Failed to fetch spans for project ${projectId}:`,
                        error instanceof Error ? error.message : String(error),
                        {projectId, spanIds, error},
                    )
                    // Set null for all failed requests
                    keys.forEach((key) => results.set(key, null))
                }
            }),
        )

        return results
    },
    resolveResult: (response, _request, serializedKey) => {
        return response.get(serializedKey) ?? null
    },
    maxBatchSize: 100,
})

// ============================================================================
// BATCH FETCHER FOR TRACES
// Collects concurrent single-trace requests and batches them
// ============================================================================

interface TraceRequest {
    projectId: string
    traceId: string
}

/**
 * Response type matching what fetchPreviewTrace returns
 * This is the OTelTracingResponse format from the backend
 */
interface TracesApiResponse {
    count?: number
    traces?: Record<string, {spans?: Record<string, unknown>}>
    spans?: unknown[]
}

/**
 * Batch fetcher that combines concurrent trace requests into a single API call
 * Uses the /preview/tracing/spans/query endpoint with trace_id IN filter
 * Same pattern as evaluationTraceBatcherFamily in EvalRunDetails
 */
const traceBatchFetcher = createBatchFetcher<
    TraceRequest,
    TracesApiResponse | null,
    Map<string, TracesApiResponse | null>
>({
    serializeKey: ({projectId, traceId}) => `${projectId}:${traceId}`,
    batchFn: async (requests, serializedKeys) => {
        const results = new Map<string, TracesApiResponse | null>()

        // Group by projectId
        const byProject = new Map<string, {traceIds: string[]; keys: string[]}>()
        requests.forEach((req, idx) => {
            const key = serializedKeys[idx]
            if (!req.projectId || !req.traceId) {
                results.set(key, null)
                return
            }
            const existing = byProject.get(req.projectId)
            if (existing) {
                existing.traceIds.push(req.traceId)
                existing.keys.push(key)
            } else {
                byProject.set(req.projectId, {traceIds: [req.traceId], keys: [key]})
            }
        })

        // Fetch each project's traces in batch using /spans/query
        await Promise.all(
            Array.from(byProject.entries()).map(async ([_projectId, {traceIds, keys}]) => {
                try {
                    // Normalize trace IDs (remove dashes) for the query
                    const canonicalIds = traceIds.map((id) => id.replace(/-/g, ""))

                    console.log("[traceBatchFetcher] Fetching traces:", {traceIds, canonicalIds})

                    const data = (await fetchAllPreviewTraces(
                        {
                            focus: "trace",
                            format: "agenta",
                            filter: JSON.stringify({
                                conditions: [
                                    {
                                        field: "trace_id",
                                        operator: "in",
                                        value: canonicalIds,
                                    },
                                ],
                            }),
                        },
                        "",
                    )) as TracesApiResponse

                    console.log("[traceBatchFetcher] Response:", {
                        hasData: !!data,
                        dataKeys: data ? Object.keys(data) : [],
                        hasTraces: !!data?.traces,
                        traceKeys: data?.traces ? Object.keys(data.traces) : [],
                    })

                    // The response has format: { traces: { [traceIdNoDashes]: { spans: {...} } } }
                    const tracesObj = data?.traces ?? {}

                    traceIds.forEach((traceId, idx) => {
                        const key = keys[idx]
                        const traceIdNoDashes = canonicalIds[idx]
                        const traceData = tracesObj[traceIdNoDashes]

                        console.log(`[traceBatchFetcher] Trace ${traceId}:`, {
                            found: !!traceData,
                            traceIdNoDashes,
                            hasSpans: !!traceData?.spans,
                            spanCount: traceData?.spans ? Object.keys(traceData.spans).length : 0,
                        })

                        if (traceData) {
                            // Return a response that looks like fetchPreviewTrace output
                            results.set(key, {
                                count: 1,
                                traces: {[traceIdNoDashes]: traceData},
                            })
                        } else {
                            results.set(key, null)
                        }
                    })
                } catch (error) {
                    console.error(
                        `[traceBatchFetcher] Failed to fetch traces:`,
                        error instanceof Error ? error.message : String(error),
                        error,
                    )
                    keys.forEach((key) => results.set(key, null))
                }
            }),
        )

        return results
    },
    resolveResult: (response, _request, serializedKey) => {
        return response.get(serializedKey) ?? null
    },
    maxBatchSize: 50,
})

// ============================================================================
// CACHE REDIRECT - Check if span exists in paginated list cache
// ============================================================================

/**
 * Look up a span in the observability list's query cache
 * Returns the span if found, undefined otherwise
 *
 * The observability list uses query keys like:
 * ["traces-list", appId, ...]
 */
const findSpanInListCache = (
    queryClient: import("@tanstack/react-query").QueryClient,
    _projectId: string,
    spanId: string,
): TraceSpan | undefined => {
    // Get all queries that match the traces-list key prefix
    const queries = queryClient.getQueriesData<{spans?: unknown[]}>({
        queryKey: ["traces-list"],
    })

    // Search through all cached pages for the span
    for (const [_queryKey, data] of queries) {
        if (data?.spans) {
            const found = data.spans.find((span: any) => span?.span_id === spanId)
            if (found) {
                try {
                    return traceSpanSchema.parse(found)
                } catch {
                    // Invalid span data, skip
                    continue
                }
            }
        }
    }

    return undefined
}

// ============================================================================
// SPAN QUERY ATOM FAMILY
// Fetches a single span by ID - uses batch fetcher + cache redirect
// ============================================================================

/**
 * Query atom family for fetching a single span
 *
 * Cache redirect strategy:
 * 1. First check paginated list query cache for the span
 * 2. If found, use as initialData (no fetch needed)
 * 3. If not found, use batch fetcher to combine concurrent requests
 *
 * This provides the "server state" for each span entity.
 */
export const spanQueryAtomFamily = atomFamily((spanId: string) =>
    atomWithQuery((get) => {
        const projectId = get(projectIdAtom)
        const queryClient = get(queryClientAtom)

        // Try to find in paginated list cache
        const cachedData =
            projectId && spanId ? findSpanInListCache(queryClient, projectId, spanId) : undefined

        return {
            queryKey: ["span", projectId, spanId],
            queryFn: async (): Promise<TraceSpan | null> => {
                if (!projectId || !spanId) return null
                return spanBatchFetcher({projectId, spanId})
            },
            // Use cached data as initial data - prevents fetch if already in paginated cache
            initialData: cachedData ?? undefined,
            // Only fetch if not in cache
            enabled: Boolean(projectId && spanId && !cachedData),
            staleTime: 60_000, // 1 minute
            gcTime: 5 * 60_000, // 5 minutes
        }
    }),
)

// ============================================================================
// NORMALIZED CACHE (DEPRECATED - will migrate to query atoms)
// ============================================================================

/**
 * Normalized cache for trace spans indexed by span_id
 * This allows O(1) lookup of any span by its ID
 *
 * @deprecated Use spanQueryAtomFamily instead. This cache is kept for backward compatibility
 * during migration but will be removed once all consumers use query atoms.
 */
export const traceSpanCacheAtom = atom<Map<string, TraceSpan>>(new Map())

/**
 * Atom family for accessing individual spans from the cache or query
 * Now prioritizes query atoms over manual cache
 *
 * Migration strategy:
 * 1. Read from query atom first (if data exists)
 * 2. Fall back to manual cache for backward compatibility
 * 3. Eventually remove manual cache entirely
 */
export const traceSpanAtomFamily = atomFamily((spanId: string) =>
    atom((get) => {
        // Try query atom first
        const query = get(spanQueryAtomFamily(spanId))
        if (query.data) {
            return query.data
        }

        // Fall back to manual cache for backward compatibility
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

// ============================================================================
// TRACE ENTITY ATOM FAMILY (fetches and caches trace by traceId)
// ============================================================================

/**
 * Atom family that fetches trace data by traceId
 *
 * Cache population strategy:
 * 1. Fetches the trace tree from the server (batched with other concurrent requests)
 * 2. Extracts all spans from the response
 * 3. Populates the span query cache for each span (for O(1) lookup later)
 * 4. Returns the trace response for rendering
 *
 * This provides entity-based access to trace data with automatic span cache population.
 * Uses batch fetching to combine multiple concurrent trace requests into a single API call.
 * Usage: const traceQuery = useAtomValue(traceEntityAtomFamily(traceId))
 */
export const traceEntityAtomFamily = atomFamily((traceId: string | null) =>
    atomWithQuery((get) => {
        const projectId = get(projectIdAtom)
        const queryClient = get(queryClientAtom)

        console.log("[traceEntityAtomFamily] Config:", {
            traceId,
            projectId,
            enabled: Boolean(traceId && projectId),
        })

        return {
            queryKey: ["trace-entity", projectId, traceId ?? "none"],
            enabled: Boolean(traceId && projectId),
            staleTime: 60_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            structuralSharing: true,
            queryFn: async () => {
                console.log("[traceEntityAtomFamily] queryFn called:", {traceId, projectId})
                if (!traceId || !projectId) return null

                // Use batch fetcher to combine concurrent trace requests
                // Returns the same format as fetchPreviewTrace: { traces: { [traceId]: { spans: {...} } } }
                const response = await traceBatchFetcher({projectId, traceId})
                console.log("[traceEntityAtomFamily] queryFn response:", {
                    traceId,
                    hasResponse: !!response,
                    responseKeys: response ? Object.keys(response) : [],
                })

                // Extract all spans from the trace response and populate query cache
                if (response?.traces) {
                    Object.values(response.traces).forEach((traceEntry) => {
                        if (traceEntry?.spans) {
                            Object.values(traceEntry.spans).forEach((spanData) => {
                                const span = traceSpanSchema.safeParse(spanData)
                                if (span.success) {
                                    const queryKey = ["span", projectId, span.data.span_id]
                                    queryClient.setQueryData(queryKey, span.data)
                                }
                            })
                        }
                    })
                }

                return response
            },
        }
    }),
)
