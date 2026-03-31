/**
 * Trace Store Types
 *
 * Type definitions for trace and span store parameters.
 */

/**
 * Parameters for fetching trace list queries
 */
export interface TraceListParams {
    projectId: string
    appId?: string | null
    focus?: "trace" | "span" | "chat"
    size?: number
    oldest?: string
    newest?: string
    filter?: string
}

/**
 * Parameters for fetching trace detail queries
 */
export interface TraceDetailParams {
    traceId: string
    spanId?: string
    projectId: string
}

/**
 * Request parameters for span batch fetcher
 */
export interface SpanRequest {
    projectId: string
    spanId: string
    traceId?: string
}

/**
 * Request parameters for trace batch fetcher
 */
export interface TraceRequest {
    projectId: string
    traceId: string
}

/**
 * Response type from trace API
 * Matches the OTelTracingResponse format from the backend
 */
export interface TracesApiResponse {
    count?: number
    traces?: Record<string, {spans?: Record<string, unknown>}>
    spans?: unknown[]
}
