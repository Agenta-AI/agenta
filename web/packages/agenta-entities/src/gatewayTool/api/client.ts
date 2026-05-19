import {getAgentaSdkClient} from "@agenta/sdk"
import {projectIdAtom} from "@agenta/shared/state"
import {getDefaultStore} from "jotai"

/**
 * Resource client for the gateway-tools API endpoints, taken from the
 * Fern-generated `@agentaai/api-client` via the workspace SDK singleton.
 *
 * The host app is responsible for initialising the SDK singleton at boot
 * (host, auth). All entities share the same instance through
 * `getAgentaSdkClient()`.
 */
export function getToolsClient() {
    return getAgentaSdkClient().tools
}

/**
 * Per-request options that scope a Fern call to the current project.
 *
 * Fern's generated tool requests don't model `project_id` — the legacy axios
 * interceptor injected it as a query param via global middleware. We mirror
 * that behaviour by reading the shared `projectIdAtom` and emitting it
 * through Fern's `BaseRequestOptions.queryParams`.
 */
export function projectScopedRequest() {
    const projectId = getDefaultStore().get(projectIdAtom)
    return projectId ? {queryParams: {project_id: projectId}} : undefined
}
