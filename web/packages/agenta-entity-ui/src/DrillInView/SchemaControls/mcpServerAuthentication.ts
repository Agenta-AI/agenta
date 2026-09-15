/**
 * The authentication half of the MCP server drawer, kept pure so the rules are testable without
 * rendering a Radix Select.
 *
 * Two of the three choices are properties of the saved agent config (`none` and a secret header
 * binding). OAuth is not: the gateway holds the grant, and the SDK's MCP credential union accepts
 * only `none` and `header_secret_refs` under `extra="forbid"`. So OAuth is expressed on the
 * endpoint row's `auth_mode`, written at registration and read back here.
 */

/** What the drawer's Authentication select can hold. */
export type McpAuthenticationType = "none" | "header_secret_refs" | "oauth"

export interface McpSecretHeaderBinding {
    name: string
    slug: string
}

/** The `connection.credentials` the drawer writes for a chosen authentication. */
export function mcpAuthenticationCredentials(
    type: McpAuthenticationType,
    secretHeader: McpSecretHeaderBinding,
): Record<string, unknown> {
    if (type !== "header_secret_refs") return {type}
    return {
        type: "header_secret_refs",
        headers:
            secretHeader.name && secretHeader.slug ? {[secretHeader.name]: secretHeader.slug} : {},
    }
}

/**
 * The authentication to show for a draft.
 *
 * A saved OAuth server carries `credentials: {type: "none"}` — the marker is normalized away on
 * commit — so the registered endpoint's `auth_mode` is the only thing that still remembers the
 * choice. A draft that names any other credential type wins, so an author editing a binding is
 * never overruled mid-edit.
 */
export function resolveMcpAuthenticationType(
    credentialType: McpAuthenticationType,
    registeredAuthMode: string | undefined,
): McpAuthenticationType {
    if (credentialType === "none" && registeredAuthMode === "oauth") return "oauth"
    return credentialType
}
