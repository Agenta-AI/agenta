/**
 * Fern client wrapper for the durable Sessions API (PR #4916).
 *
 * Mirrors `trace/api/client.ts`: all session/transcript/stream/interaction calls go
 * through the Fern-generated `@agentaai/api-client` via the workspace SDK singleton.
 * The host app initialises the singleton at boot; every entity shares it through
 * `getAgentaSdkClient()`.
 */
import {
    getLowPriorityMountsClient as getSdkLowPriorityMountsClient,
    getLowPrioritySessionsClient as getSdkLowPrioritySessionsClient,
    getMountsClient as getSdkMountsClient,
    getSessionsClient as getSdkSessionsClient,
} from "@agenta/sdk/resources"

/** The Fern `sessions` resource client (streams, transcripts, states, interactions). */
export function getSessionsClient() {
    return getSdkSessionsClient()
}

/** Same client with the `priority: "low"` fetch hint — for secondary session reads
 * (record-replay hydration, liveness polling) that must yield to the live conversation stream. */
export function getLowPrioritySessionsClient() {
    return getSdkLowPrioritySessionsClient()
}

/** The Fern `mounts` resource client (agent working-directory files). */
export function getMountsClient() {
    return getSdkMountsClient()
}

/** Same client with the `priority: "low"` fetch hint — for background mount listing. */
export function getLowPriorityMountsClient() {
    return getSdkLowPriorityMountsClient()
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

/** True for fetch/Fern abort + timeout cancellations (vs real failures).
 *
 * Fern does NOT rethrow the raw `AbortError`: its fetcher repackages an aborted request as
 * an `AgentaApiError` (name `"AgentaApiError"`, message `"The user aborted a request"`) with
 * the original `DOMException` stashed on `cause`. So we unwrap the `cause` chain and also
 * match Fern's abort marker message — otherwise cancelled queries log as real failures. */
export function isAbortError(error: unknown): boolean {
    let current: unknown = error
    for (let depth = 0; current != null && depth < 5; depth++) {
        if (
            current instanceof DOMException &&
            (current.name === "AbortError" || current.name === "TimeoutError")
        ) {
            return true
        }
        if (typeof current === "object" && current !== null) {
            const name = (current as {name?: string}).name
            const message = (current as {message?: string}).message
            if (name === "AbortError" || message === "The user aborted a request") {
                return true
            }
            current = (current as {cause?: unknown}).cause
        } else {
            break
        }
    }
    return false
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
