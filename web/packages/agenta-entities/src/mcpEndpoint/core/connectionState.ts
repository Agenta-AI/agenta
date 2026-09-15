import type {MCPEndpoint} from "./types"

// This is deliberately derived rather than persisted. `secret_id` names a vault
// record, while `flags.is_valid` is the latest gateway health result; neither a
// dashboard refresh nor a reconnect should write a second state machine onto the
// endpoint row.
export type McpConnectionState = "ready" | "needs_auth" | "needs_input"

export const getMcpConnectionState = (endpoint: MCPEndpoint): McpConnectionState => {
    if (endpoint.auth_mode === "none") return "ready"

    const hasUsableSecret = Boolean(endpoint.secret_id) && endpoint.flags?.is_valid !== false
    if (hasUsableSecret) return "ready"

    return endpoint.auth_mode === "oauth" ? "needs_auth" : "needs_input"
}

/**
 * The registered custom endpoint a slug names, or undefined when the project has none.
 *
 * An agent config item addresses its server by the slug it registered under, so this is how a
 * config row and its gateway endpoint find each other. Builtin and standard rows are excluded:
 * they are provider-managed and an author's `custom` server can legitimately share their name.
 */
export const findCustomMcpEndpoint = (
    endpoints: MCPEndpoint[] | undefined,
    slug: string | undefined,
): MCPEndpoint | undefined => {
    if (!slug) return undefined
    return (endpoints ?? []).find(
        (row) => row.slug === slug && (row.namespace ?? "custom") === "custom",
    )
}

export const getMcpConnectionStateLabel = (state: McpConnectionState): string => {
    switch (state) {
        case "ready":
            return "Ready"
        case "needs_auth":
            return "Needs authorization"
        case "needs_input":
            return "Needs input"
    }
}
