/**
 * Fern client wrapper for the durable Sessions API (PR #4916).
 *
 * Mirrors `trace/api/client.ts`: all session/transcript/stream/interaction calls go
 * through the Fern-generated `@agentaai/api-client` via the workspace SDK singleton.
 * The host app initialises the singleton at boot; every entity shares it through
 * `getAgentaSdkClient()`.
 */
import {getAgentaSdkClient} from "@agenta/sdk"

/** The Fern `sessions` resource client (streams, transcripts, states, interactions). */
export function getSessionsClient() {
    return getAgentaSdkClient().sessions
}

/** The Fern `mounts` resource client (agent working-directory files). */
export function getMountsClient() {
    return getAgentaSdkClient().mounts
}

/**
 * Per-request options scoping a Fern call to a project (and optionally an application).
 *
 * STANDING RULE: project/app scope ALWAYS rides queryParams, never the body. `abortSignal`
 * is threaded so TanStack Query can cancel in-flight requests.
 */
export function projectScopedRequest(projectId: string, appId?: string, abortSignal?: AbortSignal) {
    const queryParams: Record<string, string> = {}
    if (projectId) queryParams.project_id = projectId
    if (appId) queryParams.application_id = appId
    return {queryParams, abortSignal}
}

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

/**
 * Boundary wrapper for Fern calls. Fern throws `AgentaApiError` on non-2xx; we return
 * null on failure (logged) and rethrow aborts so query clients cancel cleanly.
 */
export async function callFern<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    try {
        return await fn()
    } catch (error) {
        if (isAbortError(error)) throw error
        console.error(`${label} failed:`, error instanceof Error ? error.message : String(error))
        return null
    }
}
