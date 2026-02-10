/**
 * Trace Entity Store
 *
 * This module provides Jotai atoms and batch fetchers for trace and span entities.
 * Uses @agenta/shared for common utilities and @agenta/entities/shared for draft state.
 *
 * @example
 * ```typescript
 * import {
 *   spanQueryAtomFamily,
 *   traceSpanEntityAtomFamily,
 *   invalidateTraceEntityCache,
 * } from '@agenta/entities/trace'
 *
 * // In components
 * const spanQuery = useAtomValue(spanQueryAtomFamily(spanId))
 * const span = useAtomValue(traceSpanEntityAtomFamily(spanId))
 * ```
 */

import {projectIdAtom} from "@agenta/shared/state"
import {createBatchFetcher} from "@agenta/shared/utils"
import {atom, getDefaultStore} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery, queryClientAtom} from "jotai-tanstack-query"

import {createEntityDraftState, normalizeValueForComparison} from "../../shared"
import {fetchAllPreviewTraces} from "../api"
import {isSpansResponse} from "../api/helpers"
import type {SpanRequest, TraceRequest, TracesApiResponse} from "../core"
import {traceSpanSchema, type TraceSpan} from "../core"
import {extractAgData, extractInputs, extractOutputs} from "../utils"

// ============================================================================
// CACHE INVALIDATION
// ============================================================================

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
// BATCH FETCHER FOR SPANS
// Collects concurrent single-span requests and batches them
// ============================================================================

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
                        projectId,
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

/**
 * Batch fetcher that combines concurrent trace requests into a single API call
 * Uses the /preview/tracing/spans/query endpoint with trace_id IN filter
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
            Array.from(byProject.entries()).map(async ([projectId, {traceIds, keys}]) => {
                try {
                    // Normalize trace IDs (remove dashes) for the query
                    const canonicalIds = traceIds.map((id) => id.replace(/-/g, ""))

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
                        projectId,
                    )) as TracesApiResponse

                    // The response has format: { traces: { [traceIdNoDashes]: { spans: {...} } } }
                    const tracesObj = data?.traces ?? {}

                    traceIds.forEach((traceId, idx) => {
                        const key = keys[idx]
                        const traceIdNoDashes = canonicalIds[idx]
                        const traceData = tracesObj[traceIdNoDashes]

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
// CACHE REDIRECT - Check if span exists in cached data
// ============================================================================

/**
 * Recursively search for a span in nested trace data structures
 */
const findSpanInTraceData = (data: unknown, spanId: string): unknown | undefined => {
    if (!data || typeof data !== "object") return undefined

    const dataObj = data as Record<string, unknown>

    // Check if this object is the span we're looking for
    if (dataObj?.span_id === spanId) return data

    // Check traces object (from trace-entity responses)
    if (dataObj?.traces) {
        const traces = dataObj.traces as Record<string, Record<string, unknown>>
        for (const traceData of Object.values(traces)) {
            if (traceData?.spans) {
                const spans = traceData.spans as Record<string, unknown>
                for (const span of Object.values(spans)) {
                    const spanObj = span as Record<string, unknown>
                    if (spanObj?.span_id === spanId) return span
                }
            }
        }
    }

    // Check response.tree structure (from trace-drawer agenta format)
    if (dataObj?.response) {
        const response = dataObj.response as Record<string, unknown>
        if (response?.tree) {
            const found = findSpanInTree(response.tree, spanId)
            if (found) return found
        }
    }

    // Check spans array (from traces-list)
    if (Array.isArray(dataObj?.spans)) {
        const spans = dataObj.spans as Record<string, unknown>[]
        const found = spans.find((s) => s?.span_id === spanId)
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

    const nodeObj = node as Record<string, unknown>

    // Check if this node is the span
    if (nodeObj?.span_id === spanId) return node

    // Check children
    if (nodeObj?.children) {
        return findSpanInTree(nodeObj.children, spanId)
    }

    // Check nodes (for tree structures)
    if (nodeObj?.nodes) {
        return findSpanInTree(nodeObj.nodes, spanId)
    }

    return undefined
}

/**
 * Look up a span in various caches
 * Checks: traces-list, trace-drawer, trace-entity caches
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

    return undefined
}

// ============================================================================
// CUSTOM ERROR CLASSES
// ============================================================================

/**
 * Custom error for span not found - triggers retry
 */
export class SpanNotFoundError extends Error {
    constructor(spanId: string) {
        super(`Span ${spanId} not found - may not be ingested yet`)
        this.name = "SpanNotFoundError"
    }
}

/**
 * Custom error for trace not found - triggers retry
 */
export class TraceNotFoundError extends Error {
    constructor(traceId: string) {
        super(`Trace ${traceId} not found - may not be ingested yet`)
        this.name = "TraceNotFoundError"
    }
}

// ============================================================================
// SPAN QUERY ATOM FAMILY
// Fetches a single span by ID - uses batch fetcher + cache redirect
// ============================================================================

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
 * - This handles the case where span hasn't been ingested yet
 *
 * This provides the "server state" for each span entity.
 */
export const spanQueryAtomFamily = atomFamily((spanId: string) =>
    atomWithQuery((get) => {
        const projectId = get(projectIdAtom)
        const queryClient = get(queryClientAtom)

        // Try to find in any cached trace data
        const cachedData = spanId ? findSpanInCache(queryClient, spanId) : undefined

        console.log("[spanQueryAtomFamily] Query config:", {
            spanId,
            projectId,
            hasCachedData: !!cachedData,
            enabled: Boolean(projectId && spanId),
        })

        return {
            queryKey: ["span", projectId, spanId],
            queryFn: async (): Promise<TraceSpan | null> => {
                console.log("[spanQueryAtomFamily] Fetching span:", {spanId, projectId})
                if (!projectId || !spanId) return null
                const result = await spanBatchFetcher({projectId, spanId})
                console.log("[spanQueryAtomFamily] Fetch result:", {spanId, hasResult: !!result})
                // Throw if not found - triggers retry (span may not be ingested yet)
                if (!result) {
                    throw new SpanNotFoundError(spanId)
                }
                return result
            },
            // Use cached data as initial data - prevents fetch if already in cache
            initialData: cachedData ?? undefined,
            // Always fetch if we have projectId and spanId (cache redirect handles deduplication)
            enabled: Boolean(projectId && spanId),
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

        return {
            queryKey: ["trace-entity", projectId, traceId ?? "none"],
            enabled: Boolean(traceId && projectId),
            staleTime: 60_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            structuralSharing: true,
            queryFn: async () => {
                if (!traceId || !projectId) return null

                // Use batch fetcher to combine concurrent trace requests
                // Returns the same format as fetchPreviewTrace: { traces: { [traceId]: { spans: {...} } } }
                const response = await traceBatchFetcher({projectId, traceId})

                // Throw if not found - triggers retry (trace may not be ingested yet)
                if (!response || !response.traces || Object.keys(response.traces).length === 0) {
                    throw new TraceNotFoundError(traceId)
                }

                // Extract all spans from the trace response and populate query cache
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

                return response
            },
            // Retry configuration for traces not yet ingested
            retry: (failureCount, error) => {
                // Only retry TraceNotFoundError, not other errors
                if (error instanceof TraceNotFoundError && failureCount < 5) {
                    return true
                }
                return false
            },
            retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000), // 1s, 2s, 4s, 8s, 10s
        }
    }),
)
