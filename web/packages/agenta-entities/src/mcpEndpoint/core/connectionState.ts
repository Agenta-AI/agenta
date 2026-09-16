import type {MCPEndpoint} from "./types"

// This is deliberately derived rather than persisted. `secret_id` names a vault
// record, while `flags.is_valid` is the latest gateway health result; neither a
// dashboard refresh nor a reconnect should write a second state machine onto the
// endpoint row.
//
// There is no fourth state for a server that is down, and one cannot be added here. The only
// failure signal on the row is `flags.is_valid`, which the backend writes when a data-plane call
// was REFUSED with the secret handle the row still holds. A server that never answered leaves it
// untouched, so a state derived from it would call an expired login an unreachable host. The list
// surfaces name that gap where they meet it, in `connectionStatus.ts`.
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

/**
 * What each state is called, everywhere it is shown.
 *
 * One word per state, on every surface. The settings list said Ready and the agent
 * configuration said Authorized for the same connection, which reads as two different states
 * to anyone moving between them. "Connected" is the word the connection UX document uses, and
 * the one the journey's own success line already says.
 */
export const getMcpConnectionStateLabel = (state: McpConnectionState): string => {
    switch (state) {
        case "ready":
            return "Connected"
        case "needs_auth":
            return "Needs authorization"
        case "needs_input":
            return "Needs input"
    }
}
