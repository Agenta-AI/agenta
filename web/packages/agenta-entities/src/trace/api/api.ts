/**
 * Trace API functions
 *
 * This module provides API functions for fetching trace and span data.
 * Uses the shared axios instance which should be configured with auth interceptors
 * by the app at startup.
 *
 * @example
 * ```typescript
 * import { fetchAllPreviewTraces, fetchPreviewTrace } from '@agenta/entities/trace'
 *
 * const spans = await fetchAllPreviewTraces({ size: 100, focus: 'span' }, appId)
 * const trace = await fetchPreviewTrace(traceId, projectId)
 * ```
 */

import type {AgentaApi} from "@agentaai/api-client"

// See testcase/api/api.ts for rationale — the shared barrel pulls in CSS deps.
import {safeParseWithLogging} from "../../shared/utils/zodSchema"
import {
    spansResponseSchema,
    sessionIdsResponseSchema,
    traceIdResponseSchema,
    traceResponseSchema,
    tracesArrayResponseSchema,
    analyticsResponseSchema,
    type SpansResponse,
    type TracesResponse,
    type SessionIdsResponse,
    type TraceIdResponse,
    type AnalyticsResponse,
} from "../core"

import {fernTracesToLegacyTraceMap} from "./adapters"
// AGE-3788: all trace api functions are migrated to the Fern client
// (Phases 1-5): sessions, delete, single-trace, flat-span (querySpans) and
// trace-tree (queryTraces). No raw axios remains in this module.
import {
    callFern,
    getLowPriorityTracesClient,
    getTracesClient,
    isAbortError,
    projectScopedRequest,
} from "./client"
import {buildSpansQueryRequest, buildTracesQueryRequest} from "./request"

/**
 * Query parameters for fetching traces/spans
 */
export interface TraceQueryParams {
    size?: number
    focus?: "trace" | "span" | "chat"
    format?: string
    filter?: string | Record<string, unknown>
    oldest?: string
    newest?: string
    cursor?: string
    [key: string]: unknown
}

/**
 * Fetch preview traces/spans from the API.
 *
 * @param params - Query parameters for filtering
 * @param appId - Application ID (optional)
 * @param projectId - Project ID (required)
 * @param opts.lowPriority - Send with the `priority: "low"` fetch hint (background hydration)
 * @returns API response with spans (validated)
 */
export async function fetchAllPreviewTraces(
    params: TraceQueryParams = {},
    appId: string,
    projectId: string,
    {lowPriority = false}: {lowPriority?: boolean} = {},
): Promise<SpansResponse | TracesResponse | null> {
    // AGE-3788 Phases 4-5: flat-span queries (focus !== "trace") go through Fern
    // querySpans (POST /spans/query, flat SpansResponse); trace-tree queries
    // (focus === "trace") go through queryTraces (POST /traces/query ->
    // {traces: TraceOutput[]}, adapted back to the legacy map so the coalescer,
    // prefetch, ETL and OSS drawers keep reading data.traces[traceIdNoDashes]).
    // The new /spans/query rejects focus="trace" with 409.
    //
    // OQ(P5 integration): the trace-tree callers pass UNDASHED trace_ids in the
    // filter (matching the legacy /tracing/spans/query behaviour). Whether
    // /traces/query accepts undashed ids in `filtering` must be confirmed
    // against a live backend — preserved as-is; covered by integration, not units.
    const opts = projectScopedRequest(projectId, appId)
    const client = lowPriority ? getLowPriorityTracesClient() : getTracesClient()
    const data = await callFern("[fetchAllPreviewTraces]", () =>
        params.focus !== "trace"
            ? client.querySpans(buildSpansQueryRequest(params), opts)
            : client.queryTraces(buildTracesQueryRequest(params), opts),
    )
    if (!data) return null
    return parseSpansOrTraces(params.focus, data)
}

/**
 * Parse + adapt a raw Fern response by focus: flat-span (`SpansResponse`) or
 * trace-tree (`{traces: TraceOutput[]}` -> legacy map). Shared by the plain and
 * the `WithMeta` fetchers so the focus handling lives in one place.
 */
function parseSpansOrTraces(
    focus: TraceQueryParams["focus"],
    data: unknown,
): SpansResponse | TracesResponse | null {
    if (focus !== "trace") {
        return safeParseWithLogging(spansResponseSchema, data, "[fetchAllPreviewTraces:spans]")
    }
    const parsed = safeParseWithLogging(
        tracesArrayResponseSchema,
        data,
        "[fetchAllPreviewTraces:traces]",
    )
    if (!parsed) return null
    return fernTracesToLegacyTraceMap(parsed.traces ?? [])
}

/**
 * Bucket state for adaptive pacing. `null` when the backend didn't return the
 * corresponding header (OSS deployments without EE throttling, errors before
 * headers, etc.).
 */
export interface PreviewTracesRateLimit {
    /** `X-RateLimit-Remaining` — tokens left in the throttle bucket. */
    remaining: number | null
    /** `X-RateLimit-Limit` — bucket capacity. Only set on 429 responses. */
    limit: number | null
}

/** Successful return shape from `fetchAllPreviewTracesWithMeta`. */
export interface PreviewTracesWithMetaResult {
    data: SpansResponse | TracesResponse | null
    rateLimit: PreviewTracesRateLimit
}

const parseRateLimitHeader = (headers: Headers, name: string): number | null => {
    const raw = headers.get(name)
    if (!raw) return null
    const n = Number.parseInt(raw, 10)
    return Number.isFinite(n) ? n : null
}

/**
 * Variant of `fetchAllPreviewTraces` that also returns the throttling bucket
 * state via `X-RateLimit-*` response headers. Used by the bulk export to pace
 * requests adaptively without knowing the user's plan tier.
 *
 * AGE-3788 Phase 5 (CQ2): migrated to the Fern client. Uses `.withRawResponse()`
 * to read the headers off the raw `Response` (Fern's typed methods otherwise
 * discard them). Same focus branching as `fetchAllPreviewTraces`.
 *
 * INTEGRATION-VERIFY (not unit-testable): the `X-RateLimit-*` headers must
 * survive Fern's transport on a live backend, and the bulk-export pacing must
 * still throttle correctly. Confirm against a running server.
 */
export async function fetchAllPreviewTracesWithMeta(
    params: TraceQueryParams = {},
    appId: string,
    projectId: string,
    signal?: AbortSignal,
): Promise<PreviewTracesWithMetaResult> {
    const opts = projectScopedRequest(projectId, appId, signal)
    const empty: PreviewTracesRateLimit = {remaining: null, limit: null}
    try {
        const {data, rawResponse} =
            params.focus !== "trace"
                ? await getTracesClient()
                      .querySpans(buildSpansQueryRequest(params), opts)
                      .withRawResponse()
                : await getTracesClient()
                      .queryTraces(buildTracesQueryRequest(params), opts)
                      .withRawResponse()

        const headers = rawResponse.headers
        return {
            data: parseSpansOrTraces(params.focus, data),
            rateLimit: {
                remaining: parseRateLimitHeader(headers, "x-ratelimit-remaining"),
                limit: parseRateLimitHeader(headers, "x-ratelimit-limit"),
            },
        }
    } catch (error) {
        if (isAbortError(error)) throw error

        console.error(
            "[fetchAllPreviewTracesWithMeta] failed:",
            error instanceof Error ? error.message : String(error),
        )
        return {data: null, rateLimit: empty}
    }
}

/**
 * Fetch a single trace by ID.
 *
 * @param traceId - Trace ID to fetch
 * @param projectId - Project ID
 * @returns Trace span data (validated)
 */
export async function fetchPreviewTrace(
    traceId: string,
    projectId: string,
): Promise<TracesResponse | null> {
    // AGE-3788 Phase 3: GET /traces/{id} via Fern (was GET /tracing/traces/{id}).
    // The new TraceResponse = {count, trace: TraceOutput}. We validate it then
    // adapt to the legacy map shape {traces:{[traceIdNoDashes]:{spans}}} so the
    // existing consumers stay unchanged:
    //   - drawer stores' normalizeTracesResponse take the `raw.traces` branch
    //   - annotationFormController reads `traces[traceKeyNoDashes].spans`
    // (This refines the eng-review A1 note: consumers want the MAP, not nodes —
    //  verified against the real call sites.) Retired in Phase 7.
    const data = await callFern("[fetchPreviewTrace]", () =>
        getTracesClient().fetchTrace({trace_id: traceId}, projectScopedRequest(projectId)),
    )
    if (!data) return null
    const parsed = safeParseWithLogging(traceResponseSchema, data, "[fetchPreviewTrace]")
    if (!parsed) return null
    return fernTracesToLegacyTraceMap(parsed.trace ? [parsed.trace] : [])
}

/**
 * Delete a trace by ID.
 *
 * @param traceId - Trace ID to delete
 * @param projectId - Project ID
 * @returns Delete response
 */
export async function deletePreviewTrace(
    traceId: string,
    projectId: string,
): Promise<TraceIdResponse | null> {
    // AGE-3788 Phase 2: DELETE /traces/{id} via Fern (was DELETE /tracing/traces/{id}).
    // Response shape changed {links:[...]} -> {count, trace_id}; consumers ignore
    // the body, but we validate it for safety per the keep-zod-at-boundary rule.
    const data = await callFern("[deletePreviewTrace]", () =>
        getTracesClient().deleteTrace({trace_id: traceId}, projectScopedRequest(projectId)),
    )
    if (!data) return null
    return safeParseWithLogging(traceIdResponseSchema, data, "[deletePreviewTrace]")
}

/**
 * Session query parameters
 */
export interface SessionQueryParams {
    appId?: string
    windowing?: {
        oldest?: string
        newest?: string
        next?: string
        limit?: number
        order?: string
    }
    cursor?: string
    filter?: unknown
    realtime?: boolean
}

/**
 * Fetch sessions with filtering and pagination.
 *
 * @param params - Session query parameters
 * @param projectId - Project ID
 * @returns Session list response
 */
export async function fetchSessions(
    params: SessionQueryParams,
    projectId: string,
): Promise<SessionIdsResponse | null> {
    // AGE-3788 Phase 1: POST /spans/sessions/query via Fern (was /tracing/sessions/query).
    // Request/response shapes are identical; the new SessionsQueryRequest is
    // {realtime?, windowing?} — the legacy `filter` param has no equivalent and
    // was always passed undefined by the sessions list, so it is dropped.
    const windowing: Record<string, unknown> = {...(params.windowing || {})}
    if (params.cursor) windowing.next = params.cursor

    const request: AgentaApi.SessionsQueryRequest = {}
    if (Object.keys(windowing).length > 0) request.windowing = windowing as AgentaApi.Windowing
    if (params.realtime !== undefined) request.realtime = params.realtime

    const data = await callFern("[fetchSessions]", () =>
        getTracesClient().querySpansSessions(
            request,
            projectScopedRequest(projectId, params.appId),
        ),
    )
    if (!data) return null
    return safeParseWithLogging(sessionIdsResponseSchema, data, "[fetchSessions]")
}

export interface SpansAnalyticsParams {
    projectId: string
    appId?: string | null
    /** Aggregation focus — "trace" mirrors the legacy dashboard query. */
    focus?: AgentaApi.Focus
    /** Bucket size in minutes. */
    interval?: number
    /** ISO window bounds (inclusive). `newest` undefined means "now". */
    oldest?: string
    newest?: string
    /**
     * Structured span filter (`{conditions: [...]}`), same dialect as the
     * legacy analytics `filter` body. Serialized to the JSON-string `filter`
     * query param expected by the new endpoint.
     */
    filter?: unknown
    abortSignal?: AbortSignal
}

/**
 * POST /spans/analytics/query via Fern (`querySpansAnalytics`) — replaces the
 * deprecated `POST /tracing/spans/analytics` used by the observability
 * generation dashboard (AGE-3788 Phase 6).
 *
 * `specs` is intentionally omitted: when absent, the backend applies its
 * `DEFAULT_ANALYTICS_SPECS` (duration / errors / costs / tokens cumulative +
 * trace/span type counts), which is exactly the set the dashboard needs. The
 * response `buckets[].metrics` dict is keyed by each spec's dotted path; the
 * OSS transform (`analyticsToGeneration`) reads the numeric fields it needs.
 */
export async function fetchSpansAnalytics(
    params: SpansAnalyticsParams,
): Promise<AnalyticsResponse | null> {
    const {
        projectId,
        appId,
        focus = "trace",
        interval,
        oldest,
        newest,
        filter,
        abortSignal,
    } = params

    if (!projectId) return null

    const request: AgentaApi.QuerySpansAnalyticsRequest = {focus}
    if (interval !== undefined) request.interval = interval
    if (oldest) request.oldest = oldest
    if (newest) request.newest = newest
    // `filter`/`specs` are JSON-string query params on the new endpoint.
    if (filter !== undefined && filter !== null) request.filter = JSON.stringify(filter)

    const data = await callFern("[fetchSpansAnalytics]", () =>
        getTracesClient().querySpansAnalytics(
            request,
            projectScopedRequest(projectId, appId ?? undefined, abortSignal),
        ),
    )
    if (!data) return null
    return safeParseWithLogging(analyticsResponseSchema, data, "[fetchSpansAnalytics]")
}
