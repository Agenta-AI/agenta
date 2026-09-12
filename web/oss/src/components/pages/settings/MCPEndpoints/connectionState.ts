import {MCPEndpoint} from "@/oss/services/mcpEndpoints/types"

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
