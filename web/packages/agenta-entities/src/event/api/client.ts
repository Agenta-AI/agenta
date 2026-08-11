import {getEventsClient as getSdkEventsClient} from "@agenta/sdk/resources"

/**
 * Resource client for the events / audit-log API, taken from the
 * Fern-generated `@agentaai/api-client` via the per-resource SDK accessor.
 *
 * The host app pins the SDK host at boot (`configureAgentaSdk`); this accessor
 * lazily constructs a host-pinned singleton for just the events resource.
 */
export function getEventsClient() {
    return getSdkEventsClient()
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
