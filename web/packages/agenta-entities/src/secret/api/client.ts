import {getSecretsClient as getSdkSecretsClient} from "@agenta/sdk/resources"

/**
 * Resource client for the vault/secrets API endpoints, taken from the
 * Fern-generated `@agentaai/api-client` via the per-resource SDK accessor.
 *
 * The host app pins the SDK host at boot (`configureAgentaSdk`); this accessor
 * lazily constructs a host-pinned singleton for just the secrets resource.
 */
export function getSecretsClient() {
    return getSdkSecretsClient()
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
