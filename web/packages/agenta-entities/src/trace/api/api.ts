/**
 * Trace API functions
 *
 * This module provides API functions for fetching trace and span data.
 * Uses the shared axios instance which should be configured with auth interceptors
 * by the app at startup.
 *
 * Migrated from deprecated `/tracing/*` endpoints to canonical `/traces/*` and
 * `/spans/*` endpoints (see #4492).
 *
 * @example
 * ```typescript
 * import { fetchAllPreviewTraces, fetchPreviewTrace } from '@agenta/entities/trace'
 *
 * const spans = await fetchAllPreviewTraces({ size: 100 }, appId, projectId)
 * const trace = await fetchPreviewTrace(traceId, projectId)
 * ```
 */

import {axios, getAgentaApiUrl} from "@agenta/shared/api"

// See testcase/api/api.ts for rationale — the shared barrel pulls in CSS deps.
import {safeParseWithLogging} from "../../shared/utils/zodSchema"
import {
    sessionIdsResponseSchema,
    spansResponseSchema,
    traceIdResponseSchema,
    traceResponseSchema,
    type SessionIdsResponse,
    type SpansResponse,
    type TraceIdResponse,
    type TraceResponse,
} from "../core"

/**
 * Query parameters for fetching spans.
 *
 * Note: `focus` is no longer accepted — `POST /spans/query` always returns
 * flat spans. For trace-tree views, use `fetchPreviewTrace` instead.
 */
export interface TraceQueryParams {
    size?: number
    format?: string
    filter?: string | Record<string, unknown>
    oldest?: string
    newest?: string
    cursor?: string
    [key: string]: unknown
}

/**
 * Fetch spans from the API (flat list).
 *
 * Calls `POST /spans/query` which always returns a flat `SpansResponse`.
 * For trace-tree views, use `fetchPreviewTrace` instead.
 *
 * @param params - Query parameters for filtering
 * @param appId - Application ID (optional)
 * @param projectId - Project ID (required)
 * @returns Validated SpansResponse
 */
export async function fetchAllPreviewTraces(
    params: TraceQueryParams = {},
    appId: string,
    projectId: string,
): Promise<SpansResponse | null> {
    const baseUrl = getAgentaApiUrl()

    const queryParams = new URLSearchParams()
    if (projectId) queryParams.set("project_id", projectId)
    if (appId) queryParams.set("application_id", appId)

    const payload: Record<string, unknown> = {}
    Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null) return
        if (key === "size") {
            payload.limit = Number(value)
        } else if (key === "filter" && typeof value === "string") {
            try {
                payload.filter = JSON.parse(value)
            } catch {
                payload.filter = value
            }
        } else if (key === "focus") {
            // `focus` is no longer accepted by POST /spans/query — skip it.
            return
        } else {
            payload[key] = value
        }
    })

    const response = await axios.post(
        `${baseUrl}/spans/query?${queryParams.toString()}`,
        payload,
    )

    return safeParseWithLogging(spansResponseSchema, response.data, "[fetchAllPreviewTraces]")
}

/**
 * Fetch a single trace by ID (with trace-tree structure).
 *
 * Calls `GET /traces/{id}` which returns a `TraceResponse` with a single
 * `trace` object containing `trace_id` and a `spans` record.
 *
 * @param traceId - Trace ID to fetch
 * @param projectId - Project ID
 * @returns Validated TraceResponse
 */
export async function fetchPreviewTrace(
    traceId: string,
    projectId: string,
): Promise<TraceResponse | null> {
    const baseUrl = getAgentaApiUrl()

    const queryParams = new URLSearchParams()
    if (projectId) queryParams.set("project_id", projectId)

    const response = await axios.get(
        `${baseUrl}/traces/${traceId}?${queryParams.toString()}`,
    )

    return safeParseWithLogging(traceResponseSchema, response.data, "[fetchPreviewTrace]")
}

/**
 * Delete a trace by ID.
 *
 * Calls `DELETE /traces/{id}`.
 *
 * @param traceId - Trace ID to delete
 * @param projectId - Project ID
 * @returns Validated TraceIdResponse
 */
export async function deletePreviewTrace(
    traceId: string,
    projectId: string,
): Promise<TraceIdResponse | null> {
    const baseUrl = getAgentaApiUrl()

    const queryParams = new URLSearchParams()
    if (projectId) queryParams.set("project_id", projectId)

    const response = await axios.delete(
        `${baseUrl}/traces/${traceId}?${queryParams.toString()}`,
    )

    return safeParseWithLogging(traceIdResponseSchema, response.data, "[deletePreviewTrace]")
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
 * Calls `POST /spans/sessions/query`.
 *
 * @param params - Session query parameters
 * @param projectId - Project ID
 * @returns Validated SessionIdsResponse
 */
export async function fetchSessions(
    params: SessionQueryParams,
    projectId: string,
): Promise<SessionIdsResponse | null> {
    const baseUrl = getAgentaApiUrl()

    const queryParams = new URLSearchParams()
    if (projectId) queryParams.set("project_id", projectId)
    if (params.appId) queryParams.set("application_id", params.appId)

    const payload: Record<string, unknown> = {}

    if (params.windowing || params.cursor) {
        payload.windowing = {...(params.windowing || {})}
        if (params.cursor) {
            ;(payload.windowing as Record<string, unknown>).next = params.cursor
        }
    }

    if (params.filter) {
        payload.filter = params.filter
    }

    if (params.realtime !== undefined) {
        payload.realtime = params.realtime
    }

    const response = await axios.post(
        `${baseUrl}/spans/sessions/query?${queryParams.toString()}`,
        payload,
    )

    return safeParseWithLogging(sessionIdsResponseSchema, response.data, "[fetchSessions]")
}
