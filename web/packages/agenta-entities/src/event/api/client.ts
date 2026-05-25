import {getAgentaSdkClient} from "@agenta/sdk"

/**
 * Resource client for the events / audit-log API, taken from the
 * Fern-generated `@agentaai/api-client` via the workspace SDK singleton.
 *
 * The host app initialises the SDK singleton at boot (host, auth); all
 * entities share the same instance through `getAgentaSdkClient()`.
 */
export function getEventsClient() {
    return getAgentaSdkClient().events
}

/**
 * Per-request options that scope a Fern call to a specific project.
 *
 * Fern's generated events request doesn't model `project_id` — the backend
 * reads it from the auth-scoped query param. We mirror the secret/gateway-tool
 * entities by emitting it through Fern's `BaseRequestOptions.queryParams`.
 */
export function projectScopedRequest(projectId: string) {
    return {queryParams: {project_id: projectId}}
}
