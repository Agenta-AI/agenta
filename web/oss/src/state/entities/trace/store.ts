import {atom, getDefaultStore} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery, queryClientAtom} from "jotai-tanstack-query"

import {fetchAllPreviewTraces} from "@/oss/services/tracing/api"
import {isSpansResponse} from "@/oss/services/tracing/lib/helpers"
import {projectIdAtom} from "@/oss/state/project/selectors/project"
import createBatchFetcher from "@/oss/state/utils/createBatchFetcher"

import {createEntityDraftState, normalizeValueForComparison} from "../shared/createEntityDraftState"

import {traceSpanSchema, type TraceSpan} from "./schema"
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
                    // Build filter for span_ids using IN operator to fetch all in single query
                    const filter = {
                        conditions: [
                            {
                                field: "span_id",
                                operator: "in",
                                value: spanIds,
                            },
                        ],
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
 * Recursively search for a span in nested trace data structures
 */
const findSpanInTraceData = (data: unknown, spanId: string): unknown | undefined => {
    if (!data || typeof data !== "object") return undefined

    // Check if this object is the span we're looking for
    if ((data as any)?.span_id === spanId) return data

    // Check traces object (from trace-entity responses)
    if ((data as any)?.traces) {
        const traces = (data as any).traces
        for (const traceData of Object.values(traces)) {
            if ((traceData as any)?.spans) {
                const spans = (traceData as any).spans
                for (const span of Object.values(spans)) {
                    if ((span as any)?.span_id === spanId) return span
                }
            }
        }
    }

    // Check response.tree structure (from trace-drawer agenta format)
    if ((data as any)?.response?.tree) {
        const found = findSpanInTree((data as any).response.tree, spanId)
        if (found) return found
    }

    // Check spans array (from traces-list)
    if (Array.isArray((data as any)?.spans)) {
        const found = (data as any).spans.find((s: any) => s?.span_id === spanId)
        if (found) return found
    }

    return undefined
}

/**
 * Recursively search a tree structure for a span
 */
const findSpanInTree = (node: unknown, spanId: string): unknown | undefined => {
    if (!node) return undefined

    // Check array of nodes
    if (Array.isArray(node)) {
        for (const child of node) {
            const found = findSpanInTree(child, spanId)
            if (found) return found
        }
        return undefined
    }

    // Check if this node is the span
    if ((node as any)?.span_id === spanId) return node

    // Check children
    if ((node as any)?.children) {
        return findSpanInTree((node as any).children, spanId)
    }

    // Check nodes (for tree structures)
    if ((node as any)?.nodes) {
        return findSpanInTree((node as any).nodes, spanId)
    }

    return undefined
}

/**
 * Convert playground ExecutionNode to TraceSpan format
 * This allows us to use playground data directly without re-fetching
 */
const executionNodeToTraceSpan = (node: any, spanId: string): TraceSpan | undefined => {
    if (!node || !node.data) return undefined

    try {
        // Build a minimal TraceSpan from ExecutionNode
        return traceSpanSchema.parse({
            trace_id: node.root?.id || node.tree?.id || spanId,
            span_id: spanId,
            name: node.node?.name || "span",
            kind: node.otel?.kind || "INTERNAL",
            start_time: node.time?.start,
            end_time: node.time?.end,
            status_code: node.status?.code || "OK",
            attributes: {
                "ag.data": node.data,
                "ag.type": node.node?.type,
            },
        })
    } catch (e) {
        console.debug("[executionNodeToTraceSpan] Failed to convert:", e)
        return undefined
    }
}

/**
 * Look up a span in various caches
 * Checks: traces-list, trace-drawer, trace-entity caches, and playground responses
 */
const findSpanInCache = (
    queryClient: import("@tanstack/react-query").QueryClient,
    spanId: string,
): TraceSpan | undefined => {
    // Check all potentially relevant TanStack Query caches
    const cacheKeys = [["traces-list"], ["trace-drawer"], ["trace-entity"]]

    for (const keyPrefix of cacheKeys) {
        const queries = queryClient.getQueriesData({queryKey: keyPrefix})

        for (const [_queryKey, data] of queries) {
            const found = findSpanInTraceData(data, spanId)
            if (found) {
                try {
                    return traceSpanSchema.parse(found)
                } catch {
                    // Invalid span data, continue searching
                    continue
                }
            }
        }
    }

    // Check playground response cache (responseAtom from useStatelessVariants)
    try {
        // Import lazily to avoid circular dependencies
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const {getAllResponses} = require("@/oss/lib/hooks/useStatelessVariants/state")
        const responses = getAllResponses()

        for (const response of Object.values(responses)) {
            const tree = (response as any)?.response?.tree
            if (!tree?.nodes) continue

            // tree.nodes is an array of ExecutionNode
            const nodes = Array.isArray(tree.nodes) ? tree.nodes : Object.values(tree.nodes)
            for (const node of nodes) {
                // Check both node.node.id (UUID format) and node.span_id (OTel hex format)
                // The drawer passes spanId in hex format from response.tree.nodes[0].span_id
                if (node?.node?.id === spanId || node?.span_id === spanId) {
                    const converted = executionNodeToTraceSpan(node, spanId)
                    if (converted) return converted
                }
            }
        }
    } catch (e) {
        // Playground state not available - skip
        console.debug("[findSpanInCache] Playground state not available:", e)
    }

    return undefined
}

// ============================================================================
// SPAN QUERY ATOM FAMILY
// Fetches a single span by ID - uses batch fetcher + cache redirect
// ============================================================================

/**
 * Custom error for span not found - triggers retry
 */
class SpanNotFoundError extends Error {
    constructor(spanId: string) {
        super(`Span ${spanId} not found - may not be ingested yet`)
        this.name = "SpanNotFoundError"
    }
}

/**
 * Query atom family for fetching a single span
 *
 * Cache redirect strategy:
 * 1. Check various query caches (traces-list, trace-drawer, trace-entity)
 * 2. If found, use as initialData (no fetch needed)
 * 3. If not found, use batch fetcher to combine concurrent requests
 *
 * Retry strategy:
 * - If span is not found (null result), throws SpanNotFoundError to trigger retry
 * - Retries up to 3 times with exponential backoff (1s, 2s, 4s)
 * - This handles the case where span hasn't been ingested yet (e.g., from playground)
 *
 * This provides the "server state" for each span entity.
 */
export const spanQueryAtomFamily = atomFamily((spanId: string) =>
    atomWithQuery((get) => {
        const projectId = get(projectIdAtom)
        const queryClient = get(queryClientAtom)

        // Try to find in any cached trace data
        const cachedData = spanId ? findSpanInCache(queryClient, spanId) : undefined

        return {
            queryKey: ["span", projectId, spanId],
            queryFn: async (): Promise<TraceSpan | null> => {
                if (!projectId || !spanId) return null
                const result = await spanBatchFetcher({projectId, spanId})
                // Throw if not found - triggers retry (span may not be ingested yet)
                if (!result) {
                    throw new SpanNotFoundError(spanId)
                }
                return result
            },
            // Use cached data as initial data - prevents fetch if already in cache
            initialData: cachedData ?? undefined,
            // Only fetch if not in cache
            enabled: Boolean(projectId && spanId && !cachedData),
            staleTime: 60_000, // 1 minute
            gcTime: 5 * 60_000, // 5 minutes
            // Retry configuration for spans not yet ingested
            retry: (failureCount, error) => {
                // Only retry SpanNotFoundError, not other errors
                if (error instanceof SpanNotFoundError && failureCount < 3) {
                    return true
                }
                return false
            },
            retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 8000), // 1s, 2s, 4s
        }
    }),
)

// ============================================================================
// DRAFT STATE MANAGEMENT
// Uses shared factory for draft state with trace-specific configuration
// ============================================================================

/**
 * Type for trace span attributes (the draftable portion)
 */
type TraceSpanAttributes = TraceSpan["attributes"]

/**
 * Create draft state management for trace spans
 * Uses shared factory with trace-specific configuration
 */
const traceSpanDraftState = createEntityDraftState<TraceSpan, TraceSpanAttributes>({
    // Extract server data from query atom (single source of truth)
    entityAtomFamily: (spanId: string) => {
        const queryAtom = spanQueryAtomFamily(spanId)
        return atom((get) => get(queryAtom).data ?? null)
    },

    // Only attributes are draftable (rest of span metadata is read-only)
    getDraftableData: (span) => span.attributes || {},

    // Merge draft attributes back into span
    mergeDraft: (span, draftAttrs) => ({
        ...span,
        attributes: {...span.attributes, ...draftAttrs},
    }),

    // Custom dirty detection: compare normalized attributes
    isDirty: (currentAttrs, originalAttrs) => {
        const normalizedCurrent = normalizeValueForComparison(currentAttrs)
        const normalizedOriginal = normalizeValueForComparison(originalAttrs)
        return normalizedCurrent !== normalizedOriginal
    },
})

// Export draft atoms
export const traceSpanDraftAtomFamily = traceSpanDraftState.draftAtomFamily
export const traceSpanHasDraftAtomFamily = traceSpanDraftState.hasDraftAtomFamily
export const traceSpanIsDirtyAtomFamily = traceSpanDraftState.isDirtyAtomFamily
export const discardTraceSpanDraftAtom = traceSpanDraftState.discardDraftAtom
export const updateTraceSpanAtom = traceSpanDraftState.updateAtom

// ============================================================================
// COMBINED ENTITY ATOM FAMILY
// Returns draft if exists, otherwise server state
// This is the primary atom for UI rendering
// ============================================================================

/**
 * Combined entity atom: returns draft if exists, otherwise server data
 * This is the main read atom for trace span data in UI components
 *
 * Equivalent to testcaseEntityAtomFamily pattern
 */
export const traceSpanEntityAtomFamily = atomFamily((spanId: string) =>
    atom((get): TraceSpan | null => {
        // Use query atom directly as single source of truth for server data
        const queryState = get(spanQueryAtomFamily(spanId))
        const serverState = queryState.data ?? null
        const draftAttrs = get(traceSpanDraftAtomFamily(spanId))

        if (draftAttrs && serverState) {
            // Merge draft attributes into server state
            return {
                ...serverState,
                attributes: {...serverState.attributes, ...draftAttrs},
            }
        }

        // Return server state (or null if not loaded)
        return serverState
    }),
)

// ============================================================================
// DERIVED ATOM FAMILIES FOR SPAN DATA EXTRACTION
// ============================================================================

/**
 * Atom family to extract inputs from a span by ID
 * Usage: const inputs = useAtomValue(spanInputsAtomFamily(spanId))
 */
export const spanInputsAtomFamily = atomFamily((spanId: string) =>
    atom((get) => {
        const span = get(traceSpanEntityAtomFamily(spanId))
        return extractInputs(span)
    }),
)

/**
 * Atom family to extract outputs from a span by ID
 * Usage: const outputs = useAtomValue(spanOutputsAtomFamily(spanId))
 */
export const spanOutputsAtomFamily = atomFamily((spanId: string) =>
    atom((get) => {
        const span = get(traceSpanEntityAtomFamily(spanId))
        return extractOutputs(span)
    }),
)

/**
 * Atom family to extract all ag.data from a span by ID
 * Usage: const agData = useAtomValue(spanAgDataAtomFamily(spanId))
 */
export const spanAgDataAtomFamily = atomFamily((spanId: string) =>
    atom((get) => {
        const span = get(traceSpanEntityAtomFamily(spanId))
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
