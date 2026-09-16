/**
 * What an agent may do with one connected MCP server, per tool.
 *
 * This mirrors `MCPPolicy` in `sdks/python/agenta/sdk/agents/mcp/models.py`, which is the
 * authority. Three fields answer three different questions and are deliberately not
 * collapsed into one:
 *
 * - `tools` is a FILTER. A tool it hides is never advertised, so it needs no permission and
 *   may not be given one: the SDK refuses such an entry rather than dropping it, because the
 *   author either meant to list the tool or meant to permit a different one.
 * - `permission` is the whole-server decision, and stays the fallback so a configuration
 *   written before per-tool policy behaves exactly as it did.
 * - `tool_permissions` is the per-tool decision, keyed by the name the SERVER advertises
 *   (`echo`), never the harness-rendered one (`mcp__acme_prod__echo`). The upstream name is
 *   the only spelling every harness agrees on.
 *
 * The pair is an opt-in. With neither `tool_permissions` nor `new_tool_permission` set,
 * nothing per-tool is written and the server permission governs. With either set, the table
 * is authoritative and a run default cannot widen it, because a per-tool policy a default
 * can widen is not a policy.
 */

export type McpPermission = "allow" | "ask" | "deny"

export interface McpToolFilterPolicy {
    mode?: "all" | "include"
    names?: string[]
}

export interface McpServerPolicy {
    tools?: McpToolFilterPolicy
    permission?: McpPermission | null
    tool_permissions?: Record<string, McpPermission>
    new_tool_permission?: McpPermission | null
}

const EMPTY: McpServerPolicy = {}

/** The policy on a config item, whatever shape the item is otherwise in. */
export function readMcpPolicy(item: Record<string, unknown> | null | undefined): McpServerPolicy {
    const policy = item?.policy
    if (!policy || typeof policy !== "object") return EMPTY
    return policy as McpServerPolicy
}

export const toolPermissions = (policy: McpServerPolicy): Record<string, McpPermission> =>
    policy.tool_permissions ?? {}

/** Whether the author opted into per-tool policy for this server. */
export function isPerTool(policy: McpServerPolicy): boolean {
    return Object.keys(toolPermissions(policy)).length > 0 || policy.new_tool_permission != null
}

/** Whether the filter hides this tool, in which case it may not carry a permission. */
export function isToolHidden(policy: McpServerPolicy, toolName: string): boolean {
    if (policy.tools?.mode !== "include") return false
    return !(policy.tools.names ?? []).includes(toolName)
}

/**
 * What an advertised tool with no entry of its own gets.
 *
 * `ask` is the floor rather than "fall through to the run default": a tool nobody has looked
 * at yet must reach a human. Null means the author opted out entirely, which is what leaves
 * an existing configuration unchanged.
 */
export function resolvedNewToolPermission(policy: McpServerPolicy): McpPermission | null {
    if (!isPerTool(policy)) return null
    return policy.new_tool_permission ?? policy.permission ?? "ask"
}

/**
 * The decision one advertised tool ends up with, and where it came from.
 *
 * `source` is what the editor shows: an explicit entry reads as chosen, anything else reads
 * as inherited, and saying which is the difference between a table someone can trust and a
 * list of values with no provenance.
 */
export function effectiveToolPermission(
    policy: McpServerPolicy,
    toolName: string,
): {permission: McpPermission | null; source: "tool" | "new" | "server" | "default"} {
    const entry = toolPermissions(policy)[toolName]
    if (entry) return {permission: entry, source: "tool"}

    const resolved = resolvedNewToolPermission(policy)
    if (resolved) {
        return {
            permission: resolved,
            source: policy.new_tool_permission ? "new" : policy.permission ? "server" : "new",
        }
    }
    return {permission: policy.permission ?? null, source: policy.permission ? "server" : "default"}
}

const withoutKey = (table: Record<string, McpPermission>, key: string) => {
    const next = {...table}
    delete next[key]
    return next
}

/** Drop the per-tool fields entirely when nothing is left in them. */
function pruned(policy: McpServerPolicy): McpServerPolicy {
    const next: McpServerPolicy = {...policy}
    if (Object.keys(next.tool_permissions ?? {}).length === 0) delete next.tool_permissions
    if (next.new_tool_permission == null) delete next.new_tool_permission
    return next
}

/**
 * Set or clear one tool's permission.
 *
 * Giving a hidden tool a permission is refused rather than written, matching the SDK: it would
 * produce a configuration that fails validation on every run of the agent, not once at save.
 *
 * Clearing one is always allowed, and has to be. A filter narrowed after the fact leaves
 * entries for tools it now hides, and the SDK rejects the whole policy for exactly those
 * entries, so refusing to clear them left an agent that could not run and no way to repair it
 * from here (CR18).
 */
export function setToolPermission(
    policy: McpServerPolicy,
    toolName: string,
    permission: McpPermission | null,
): McpServerPolicy {
    if (permission && isToolHidden(policy, toolName)) return policy
    const table = toolPermissions(policy)
    return pruned({
        ...policy,
        tool_permissions: permission
            ? {...table, [toolName]: permission}
            : withoutKey(table, toolName),
    })
}

export function setNewToolPermission(
    policy: McpServerPolicy,
    permission: McpPermission | null,
): McpServerPolicy {
    return pruned({...policy, new_tool_permission: permission})
}

/** Opt out of per-tool policy, handing the server permission back its authority. */
export function clearPerToolPolicy(policy: McpServerPolicy): McpServerPolicy {
    const next: McpServerPolicy = {...policy}
    delete next.tool_permissions
    delete next.new_tool_permission
    return next
}

/**
 * Entries naming tools the server no longer advertises.
 *
 * Kept rather than pruned: a server can stop advertising a tool temporarily, and silently
 * dropping the author's decision would re-admit it under the new-tool default when it came
 * back. Shown, so someone can remove it on purpose.
 */
export function staleToolPermissions(policy: McpServerPolicy, advertised: string[]): string[] {
    const known = new Set(advertised)
    return Object.keys(toolPermissions(policy))
        .filter((name) => !known.has(name))
        .sort()
}
