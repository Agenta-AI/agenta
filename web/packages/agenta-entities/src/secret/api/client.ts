import {getAgentaSdkClient} from "@agenta/sdk"

/**
 * Resource client for the vault/secrets API endpoints, taken from the
 * Fern-generated `@agentaai/api-client` via the workspace SDK singleton.
 *
 * The host app is responsible for initialising the SDK singleton at boot
 * (host, auth). All entities share the same instance through
 * `getAgentaSdkClient()`.
 */
export function getSecretsClient() {
    return getAgentaSdkClient().secrets
}

/**
 * Per-request options that scope a Fern call to a specific project.
 *
 * Fern's generated secrets requests don't model `project_id` — the legacy
 * axios layer injected it as a query param via global middleware. We mirror
 * that behaviour by emitting it through Fern's
 * `BaseRequestOptions.queryParams`.
 *
 * Unlike the gateway-tools entity (which reads `projectIdAtom`
 * imperatively), the secret entity's call sites already have the
 * `projectId` in scope, so we keep it as an explicit argument.
 */
export function projectScopedRequest(projectId: string) {
    return {queryParams: {project_id: projectId}}
}
