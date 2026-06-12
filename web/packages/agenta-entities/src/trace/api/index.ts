/**
 * API Layer
 *
 * Exports HTTP API functions and helper utilities for trace/span data.
 */

// API functions
export {
    fetchAllPreviewTraces,
    fetchAllPreviewTracesWithMeta,
    fetchPreviewTrace,
    deletePreviewTrace,
    fetchSessions,
    fetchSpansAnalytics,
    type TraceQueryParams,
    type SessionQueryParams,
    type SpansAnalyticsParams,
    type PreviewTracesRateLimit,
    type PreviewTracesWithMetaResult,
} from "./api"

// Helper utilities
export {
    isTracesResponse,
    isSpansResponse,
    sortSpansByStartTime,
    transformTracesResponseToTree,
    transformTracingResponse,
} from "./helpers"

// Fern client + request builders + boundary adapters (AGE-3788 scaffolding)
export {getTracesClient, projectScopedRequest, callFern} from "./client"
export {buildSpansQueryRequest, buildTracesQueryRequest, toFilteringInput} from "./request"
export {fernTraceOutputToNodes, fernTracesToLegacyTraceMap, fernSpansToNodes} from "./adapters"
