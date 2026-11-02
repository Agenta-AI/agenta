/**
 * The two rules the agent rail's MCP rows follow. Pure, so both the panel and its tests run
 * the same code rather than two descriptions of it.
 */
import {USER_ACCOUNT_SOURCE, type AccountSource} from "@agenta/entities/accountChoice"
import {
    buildMcpConnectionRef,
    isLegacyMcpItem,
    RESERVED_TOOL_PREFIX,
    toolPrefixFromName,
    type MCPEndpoint,
} from "@agenta/entities/mcpEndpoint"

/**
 * Whether a saved MCP item has to open its form rather than its permissions.
 *
 * A row that resolves to a live connection has nothing left to configure but what the agent
 * may do with it, so it goes straight there. A row that does not resolve — saved before
 * connections were shared, pointing at a connection that is gone, or carrying the reserved
 * prefix — goes to the form, because the form's three notices are the only explanation of
 * the problem and the only route that repairs it. Sending that row to a permission drawer
 * would strand it: the drawer cannot list tools it cannot reach and offers no way back.
 */
export const mcpItemNeedsRepair = (
    item: Record<string, unknown> | null | undefined,
    endpoint: MCPEndpoint | undefined,
): boolean => {
    if (!item) return true
    if (isLegacyMcpItem(item)) return true
    if (!endpoint) return true
    return item.name === RESERVED_TOOL_PREFIX
}

/**
 * The agent item written when a connection is added to this agent.
 *
 * Two fields, answering different questions. `connection.slug` is what the gateway resolves
 * at run time. `name` is the prefix the model sees on this server's tools, frozen here:
 * renaming the connection later must not rename tools in an agent that is already saved,
 * because its per-tool rules are keyed by the old spelling.
 *
 * No server permission is written, and that absence IS the value (decision 36): with no
 * `permission` the run's own permission ladder decides. The drawer reads that absence back as the
 * preset named for it, "Follow agent policy", which is also what every row here reads (decision
 * 45). Writing "allow" here would let every tool of a server nobody has looked at run unapproved,
 * the direction the D88 review closed.
 */
export const buildMcpAgentItem = (option: {
    slug: string
    name: string
}): Record<string, unknown> => ({
    name: toolPrefixFromName(option.name) ?? option.slug,
    connection: buildMcpConnectionRef(option.slug),
    policy: {tools: {mode: "all"}},
})

/** Whose sign-in an MCP item uses: each person's own (`"user"`), or the project's (`"agent"`). */
export const readMcpAccountSource = (
    item: Record<string, unknown> | null | undefined,
): AccountSource => {
    const connection = item?.connection
    return connection &&
        typeof connection === "object" &&
        (connection as Record<string, unknown>).account_source === USER_ACCOUNT_SOURCE
        ? USER_ACCOUNT_SOURCE
        : "agent"
}

/**
 * The item with the MCP drawer's "Account" choice written on its connection. A `"user"` item keeps
 * its slug, because the slug names the project's server and the account is the person's sign-in
 * to it; the project's sign-in drops `account_source` (contract section 5.1). Only a `custom`
 * server takes `"user"`, so any other item comes back unchanged.
 */
export const withMcpAccountSource = (
    item: Record<string, unknown>,
    source: AccountSource,
): Record<string, unknown> => {
    const connection = item.connection
    if (!connection || typeof connection !== "object") return item
    const {account_source: _previous, ...rest} = connection as Record<string, unknown>
    const user = source === USER_ACCOUNT_SOURCE
    if (user && rest.namespace !== "custom") return item
    return {...item, connection: user ? {...rest, account_source: USER_ACCOUNT_SOURCE} : rest}
}
