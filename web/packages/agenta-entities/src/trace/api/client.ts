/**
 * Fern client wrapper for the tracing API (AGE-3788).
 *
 * All trace/span/session/analytics calls go through the Fern-generated
 * `@agentaai/api-client` via the workspace SDK singleton, replacing the raw
 * axios/fetch layer. The host app initialises the SDK singleton at boot
 * (host, auth); all entities share the same instance through
 * `getAgentaSdkClient()`.
 *
 * Pattern mirrors `secret/api/client.ts` and `workflow/api/api.ts`.
 */
import {getTracesClient as getSdkTracesClient} from "@agenta/sdk/resources"

/** The Fern `traces` resource client (spans, traces, sessions, analytics). */
export function getTracesClient() {
    return getSdkTracesClient()
}

/**
 * Per-request options that scope a Fern call to a project (and optionally an
 * application). The new endpoints do NOT model `project_id`/`application_id`
 * in the request body — the legacy layer injected them as query params, so we
 * mirror that through Fern's `BaseRequestOptions.queryParams`.
 *
 * STANDING RULE (AGE-3788): project/app scope ALWAYS rides queryParams, never
 * the body. `abortSignal` is threaded so TanStack Query can cancel in-flight
 * requests.
 */
export function projectScopedRequest(projectId: string, appId?: string, abortSignal?: AbortSignal) {
    const queryParams: Record<string, string> = {}
    if (projectId) queryParams.project_id = projectId
    if (appId) queryParams.application_id = appId
    return {queryParams, abortSignal}
}

/**
 * Boundary wrapper for Fern calls.
 *
 * Fern methods THROW `AgentaApiError` on non-2xx, whereas the legacy raw
 * layer returned data and callers branched on shape. To preserve the existing
 * consumer contract (null on failure, parsed via zod), every migrated api
 * function wraps its Fern call here:
 *   - non-2xx / unexpected error  -> returns null (logged)
 *   - AbortError                  -> rethrown, so TanStack Query cancels
 *                                    cleanly instead of caching null
 */
/** True for fetch/Fern abort + timeout cancellations (vs real failures). */
export function isAbortError(error: unknown): boolean {
    if (
        error instanceof DOMException &&
        (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
        return true
    }
    return (
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        (error as {name?: string}).name === "AbortError"
    )
}

export async function callFern<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    try {
        return await fn()
    } catch (error) {
        // Let aborts propagate so query clients can distinguish cancel from failure.
        if (isAbortError(error)) throw error

        console.error(`${label} failed:`, error instanceof Error ? error.message : String(error))
        return null
    }
}
