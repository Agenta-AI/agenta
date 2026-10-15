// Mirror of api/oss/src/core/gateways/mcps/dtos.py + apis/fastapi/gateways/mcps/models.py
// IMPORTANT: Do not add fields that don't exist in the backend.

export type MCPAuthMode = "oauth" | "api_key" | "none"
export type MCPEndpointNamespace = "builtin" | "standard" | "custom"

export interface MCPOAuthData {
    resource?: string | null
    authorization_server?: string | null
    scopes_offered?: string[]
}

// MCPCredentialBinding: where an API-key endpoint's credential travels. Configuration, not
// the credential: the value stays in the vault behind `secret_id`.
export interface MCPCredentialBinding {
    // `url` puts the value where `base_url` holds `{secret}`.
    kind: "header" | "query" | "url"
    // The header name, or the query parameter name. Null for `url`.
    name?: string | null
    // The word in front of the value, e.g. `Bearer` or `Basic`. Null sends the bare value.
    prefix?: string | null
}

export interface MCPEndpointRoute {
    base_url?: string | null
    headers?: Record<string, string> | null
    // Null sends `Authorization: Bearer <key>`.
    credential_binding?: MCPCredentialBinding | null
}

// GatewayEndpointFilter in api/oss/src/core/gateways/dtos.py.
export interface MCPToolFilter {
    allowlist?: string[] | null
    denylist?: string[] | null
}

export interface MCPEndpointSettings {
    timeout_seconds?: number | null
}

export interface MCPEndpointData {
    route: MCPEndpointRoute
    tools?: MCPToolFilter
    settings?: MCPEndpointSettings
    oauth?: MCPOAuthData | null
}

export interface MCPEndpointFlags {
    is_active?: boolean
    is_valid?: boolean
}

export interface MCPEndpoint {
    id?: string | null
    slug?: string | null
    name?: string | null
    description?: string | null
    auth_mode: MCPAuthMode
    namespace?: MCPEndpointNamespace
    provider_key?: string | null
    integration_key?: string | null
    secret_id?: string | null
    data: MCPEndpointData
    flags?: MCPEndpointFlags
}

export interface MCPEndpointCreate {
    slug?: string | null
    name?: string | null
    description?: string | null
    auth_mode: MCPAuthMode
    secret_id?: string | null
    data: MCPEndpointData
    flags?: MCPEndpointFlags
}

export interface MCPEndpointEdit {
    id: string
    name?: string | null
    description?: string | null
    auth_mode: MCPAuthMode
    secret_id?: string | null
    data: MCPEndpointData
    flags?: MCPEndpointFlags
}

export interface MCPEndpointResponse {
    count: number
    endpoint?: MCPEndpoint | null
}

export interface MCPEndpointsResponse {
    count: number
    endpoints: MCPEndpoint[]
}

export interface MCPConnectResponse {
    count: number
    redirect_url?: string | null
    scopes_offered?: string[]
    /** Set with `redirect_url`: the attempt the callback answers for, and its lifetime. */
    attempt_id?: string | null
    expires_in?: number | null
}

/** How one consent attempt stands. Mirror of `MCPOAuthAttemptOutcome`. */
export interface MCPConnectAttempt {
    id: string
    status: "pending" | "connected" | "failed" | "cancelled"
    error?: string | null
}

export interface MCPConnectAttemptResponse {
    count: number
    attempt?: MCPConnectAttempt
}

// Mirror of MCPServerProbeResult in api/oss/src/core/gateways/mcps/probe.py.
export type MCPProbeAuthMode = "none" | "oauth" | "unknown"
export type MCPProbeRegistration = "dynamic" | "metadata" | "unavailable"

/** What the server answered: its status and the start of its body, credentials removed. */
export interface MCPProbeResponse {
    status: number
    body: string
}

export interface MCPProbeProblem {
    cause: string
    message: string
    /**
     * How the outbound attempt failed, when it failed rather than answered. A cause from the
     * backend's closed transport vocabulary, or `unresolvable` for a name that never resolved.
     * `cause` is deliberately coarse: a connection that was refused and an answer that could
     * not be read are both "unreachable" to the person connecting, and are not the same thing
     * to anything deciding whether this deployment has outbound access at all.
     */
    transport?: string | null
    /** The server's own answer, when something answered. Absent when nothing did. */
    response?: MCPProbeResponse | null
}

export interface MCPProbeAuth {
    mode: MCPProbeAuthMode
    authorization_server?: string | null
    scopes_offered?: string[]
    registration?: MCPProbeRegistration | null
    /**
     * The status a server refused the anonymous handshake with, when it refused one.
     *
     * Evidence rather than advice, and the same for `challenge_schemes`: the key screen asks
     * for a header name and this challenge is the only thing the probe ever saw about it.
     */
    challenge_status?: number | null
    /**
     * The authentication schemes the refusal's `WWW-Authenticate` named, in the order sent.
     *
     * Scheme tokens only, case as sent, because they are shown rather than compared. A
     * challenge that named none reports none; nothing here is guessed.
     */
    challenge_schemes?: string[]
}

export interface MCPServerProbe {
    reachable: boolean
    server_name?: string | null
    protocol_version?: string | null
    auth: MCPProbeAuth
    problem?: MCPProbeProblem | null
    /**
     * The address follows the legacy SSE convention, but it refused before anything proved
     * which transport it speaks. A warning for the next screen, never a refusal.
     */
    legacy_transport_suspected?: boolean
}

export interface MCPEndpointProbeResponse {
    count: number
    probe?: MCPServerProbe | null
}
