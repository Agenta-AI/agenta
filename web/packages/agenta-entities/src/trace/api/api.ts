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

import {axios, getAgentaApiUrl} from "@agenta/shared"

import {safeParseWithLogging} from "../../shared"
import {
    spansResponseSchema,
    tracesResponseSchema,
    type SpansResponse,
    type TracesResponse,
} from "../core"

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
 * @returns API response with spans (validated)
 */
export async function fetchAllPreviewTraces(
    params: TraceQueryParams = {},
    appId: string,
    projectId: string,
): Promise<SpansResponse | TracesResponse | null> {
    const baseUrl = getAgentaApiUrl()

    // Build query parameters
    const queryParams = new URLSearchParams()
    if (projectId) queryParams.set("project_id", projectId)
    if (appId) queryParams.set("application_id", appId)

    // Build request payload
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
        } else {
            payload[key] = value
        }
    })

    const response = await axios.post(
        `${baseUrl}/preview/tracing/spans/query?${queryParams.toString()}`,
        payload,
    )

    // Try parsing as SpansResponse first (spans array format)
    const spansResult = spansResponseSchema.safeParse(response.data)
    if (spansResult.success) {
        return spansResult.data
    }

    // Fall back to TracesResponse (traces record format)
    return safeParseWithLogging(tracesResponseSchema, response.data, "[fetchAllPreviewTraces]")
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
    const baseUrl = getAgentaApiUrl()

    const queryParams = new URLSearchParams()
    if (projectId) queryParams.set("project_id", projectId)

    const response = await axios.get(
        `${baseUrl}/preview/tracing/traces/${traceId}?${queryParams.toString()}`,
    )

    // API returns TracesResponse format with count and traces record
    return safeParseWithLogging(tracesResponseSchema, response.data, "[fetchPreviewTrace]")
}

/**
 * Delete a trace by ID.
 *
 * @param traceId - Trace ID to delete
 * @param projectId - Project ID
 * @returns Delete response
 */
export async function deletePreviewTrace(traceId: string, projectId: string): Promise<unknown> {
    const baseUrl = getAgentaApiUrl()

    const queryParams = new URLSearchParams()
    if (projectId) queryParams.set("project_id", projectId)

    const response = await axios.delete(
        `${baseUrl}/preview/tracing/traces/${traceId}?${queryParams.toString()}`,
    )

    return response.data
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
): Promise<unknown> {
    const baseUrl = getAgentaApiUrl()

    const queryParams = new URLSearchParams()
    if (projectId) queryParams.set("project_id", projectId)
    if (params.appId) queryParams.set("application_id", params.appId)

    const payload: Record<string, unknown> = {}

    // Initialize windowing if it doesn't exist but we have a cursor
    if (params.windowing || params.cursor) {
        payload.windowing = {...(params.windowing || {})}

        // If cursor is provided, it goes into windowing.next
        if (params.cursor) {
            ;(payload.windowing as Record<string, unknown>).next = params.cursor
        }
    }

    if (params.filter) {
        payload.filter = params.filter
    }

    // Add realtime parameter (true = latest/unstable, false/undefined = all/stable)
    if (params.realtime !== undefined) {
        payload.realtime = params.realtime
    }

    const response = await axios.post(
        `${baseUrl}/tracing/sessions/query?${queryParams.toString()}`,
        payload,
    )

    return response.data
}
