/**
 * The two rules the agent rail's MCP rows follow. Pure, so both the panel and its tests run
 * the same code rather than two descriptions of it.
 */
import {
    getMcpConnectionState,
    isLegacyMcpItem,
    RESERVED_TOOL_PREFIX,
    type MCPEndpoint,
} from "@agenta/entities/mcpEndpoint"

/**
 * Whether this server's login has to be renewed before its tools will run.
 *
 * The OAuth and the key case report the same thing, because from the agent's side they are
 * the same thing. A server that is merely unreachable is NOT distinguishable here: the only
 * failure signal on the record is written when a call fails with the credential the row
 * still holds, so a server that is simply down never sets it.
 */
export const mcpLoginExpired = (endpoint: MCPEndpoint | undefined): boolean =>
    Boolean(endpoint) && getMcpConnectionState(endpoint!) !== "ready"

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
