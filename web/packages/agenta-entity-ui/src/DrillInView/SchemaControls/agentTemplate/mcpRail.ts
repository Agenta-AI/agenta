/**
 * The two rules the agent rail's MCP rows follow. Pure, so both the panel and its tests run
 * the same code rather than two descriptions of it.
 */
import {USER_ACCOUNT_SOURCE, type AccountSource} from "@agenta/entities/accountChoice"
import {
    buildMcpConnectionRef,
    readMcpConnectionSlug,
    isLegacyMcpItem,
    RESERVED_TOOL_PREFIX,
    toolPrefixFromName,
    type MCPEndpoint,
} from "@agenta/entities/mcpEndpoint"
import type {ConfigItemRef} from "@agenta/ui/view-stack"

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

/** The agent's `mcps`, or an empty list. */
export const mcpsOf = (agent: Record<string, unknown>): unknown[] =>
    Array.isArray(agent.mcps) ? (agent.mcps as unknown[]) : []

/** The project's `custom` servers: the namespace an agent's connection reference names. */
export const customMcpEndpoints = (endpoints: MCPEndpoint[] | undefined): MCPEndpoint[] =>
    (endpoints ?? []).filter((endpoint) => (endpoint.namespace ?? "custom") === "custom")

const entryName = (item: unknown): string | undefined => {
    const name = (item as Record<string, unknown> | null)?.name
    return typeof name === "string" && name ? name : undefined
}

const entrySlug = (item: unknown): string | undefined =>
    readMcpConnectionSlug((item ?? {}) as Record<string, unknown>) ?? undefined

/**
 * The address of an MCP server in the agent's `mcps`: the key the change-set engine gives an
 * `mcps` entry, its `name` (the tool prefix frozen when the server was added), so a view and a
 * builder operation name the same server. When two entries share a name (the engine refuses such
 * a list), the entry is addressed by its connection slug, so the second never touches the first.
 * Null for an entry with no name.
 */
export const mcpItemRef = (item: unknown, mcps: unknown[]): ConfigItemRef | null => {
    const name = entryName(item)
    if (!name) return null
    const shared = mcps.filter((other) => entryName(other) === name).length > 1
    const slug = entrySlug(item)
    return shared && slug ? {list: "mcps", key: slug} : {list: "mcps", key: name}
}

/** The index of the server `ref` names: the one entry with that name, else with that slug. */
export const findMcpIndex = (mcps: unknown[], ref: ConfigItemRef): number => {
    if (ref.list !== "mcps") return -1
    const byName = mcps.flatMap((item, index) => (entryName(item) === ref.key ? [index] : []))
    if (byName.length === 1) return byName[0]
    const bySlug = mcps.flatMap((item, index) => (entrySlug(item) === ref.key ? [index] : []))
    return bySlug.length === 1 ? bySlug[0] : -1
}

/** The list with the server `ref` names replaced by `next(item)`; unchanged when it is gone. */
export const updateMcpByRef = (
    mcps: unknown[],
    ref: ConfigItemRef,
    next: (item: Record<string, unknown>) => Record<string, unknown>,
): unknown[] => {
    const index = findMcpIndex(mcps, ref)
    if (index < 0) return mcps
    return mcps.map((item, i) => (i === index ? next(item as Record<string, unknown>) : item))
}

/** The list without the server `ref` names. The project's connection stays. */
export const removeMcpByRef = (mcps: unknown[], ref: ConfigItemRef): unknown[] => {
    const index = findMcpIndex(mcps, ref)
    return index < 0 ? mcps : mcps.filter((_, i) => i !== index)
}
