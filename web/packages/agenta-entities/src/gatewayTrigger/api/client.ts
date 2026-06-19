import {axios, getAgentaApiUrl} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {getDefaultStore} from "jotai"

/**
 * HTTP client for the `/triggers/*` API.
 *
 * The triggers catalog isn't in the Fern client yet (WP1 hasn't been
 * regenerated into `@agentaai/api-client`), so we use the shared axios
 * instance. Once the client gains a `triggers` resource this module collapses
 * onto `getAgentaSdkClient().triggers` like `gatewayTool/api/client.ts`.
 */
export const triggersBaseUrl = () => `${getAgentaApiUrl()}/triggers`

/**
 * Scope a request to the current project. The shared axios interceptor does
 * not inject `project_id`, so we mirror `gatewayTool`'s `projectScopedRequest`
 * and read it from the shared atom.
 */
export function projectScopedParams(extra?: Record<string, unknown>) {
    const projectId = getDefaultStore().get(projectIdAtom)
    return {
        params: {
            ...(projectId ? {project_id: projectId} : {}),
            ...(extra ?? {}),
        },
    }
}

/**
 * Pull a human-readable message out of an axios error from the `/triggers/*`
 * API. The backend surfaces upstream provider failures (e.g. a Composio 4xx
 * rejecting a `trigger_config`) as a FastAPI `detail` — a plain string for
 * domain/adapter errors, or `{message}` for an intercepted 500. Falls back to
 * the axios message, then to `fallback`.
 */
export function triggerApiErrorMessage(error: unknown, fallback: string): string {
    const detail = (error as {response?: {data?: {detail?: unknown}}})?.response?.data?.detail
    if (typeof detail === "string" && detail.trim()) return detail
    if (detail && typeof detail === "object") {
        const message = (detail as {message?: unknown}).message
        if (typeof message === "string" && message.trim()) return message
    }
    const axiosMessage = (error as {message?: unknown})?.message
    if (typeof axiosMessage === "string" && axiosMessage.trim()) return axiosMessage
    return fallback
}

export {axios}
