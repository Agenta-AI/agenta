/**
 * The two rules the agent rail's MCP rows follow. Pure, so both the panel and its tests run
 * the same code rather than two descriptions of it.
 */
import {
    buildMcpConnectionRef,
    getMcpConnectionStatus,
    isLegacyMcpItem,
    RESERVED_TOOL_PREFIX,
    toolPrefixFromName,
    type MCPEndpoint,
} from "@agenta/entities/mcpEndpoint"

/**
 * Whether this server needs attention before its tools will run.
 *
 * Derived through the data layer's list vocabulary rather than the journey's, so a rail row
 * and a settings row cannot disagree about one connection. Today that is Connected or Login
 * expired; a server that is merely unreachable is not distinguishable, because the only
 * failure signal on the record is written when a call fails with the credential the row
 * still holds, so a server that is simply down never sets it.
 */
export const mcpLoginExpired = (endpoint: MCPEndpoint | undefined): boolean =>
    Boolean(endpoint) && getMcpConnectionStatus(endpoint!) !== "connected"

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
 * `permission` the run's own permission ladder decides, which is the "Follow agent policy"
 * preset the drawer then opens on. Writing "allow" here would let every tool of a server
 * nobody has looked at run unapproved, the direction the D88 review closed.
 */
export const buildMcpAgentItem = (option: {
    slug: string
    name: string
}): Record<string, unknown> => ({
    name: toolPrefixFromName(option.name) ?? option.slug,
    connection: buildMcpConnectionRef(option.slug),
    policy: {tools: {mode: "all"}},
})
