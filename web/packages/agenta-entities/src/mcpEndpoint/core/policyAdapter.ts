/**
 * One MCP server's policy, in the shape the shared permission drawer edits.
 *
 * The drawer was written for integrations, which save `{default, tools}` where both hold one of
 * four values including `inherit`. MCP saves `{permission, tool_permissions, new_tool_permission}`
 * where each value is one of three, and `inherit` is not among them. The two features therefore
 * do not share a saved shape, and this is the translation between them. It exists so the drawer
 * has one implementation rather than two that drift.
 *
 * `inherit` is not missing from MCP, it is spelled differently: it is the ABSENCE of a value.
 *
 * - At the server level, no `permission` means the run's own permission ladder decides, which is
 *   what `inherit` asks for. `MCPPolicy.permission` is optional for exactly that reason.
 * - At the tool level, no entry in `tool_permissions` means the tool follows whatever governs the
 *   tools the table does not name. That is what the shipped drawer already labels
 *   "Inherits ask" or "Inherits allow".
 *
 * The one thing `default` here is NOT is "the whole-server permission". It is the value a tool
 * with no entry of its own ends up with, because that is what the drawer reads it as and what
 * every rollup in `integrationPolicy.ts` computes from. Those are the same value only while no
 * per-tool table is declared. Once one is, the SDK and the runner both stop consulting the server
 * permission and use the table's own floor, `new_tool_permission` or `ask`
 * (`MCPPolicy.resolved_new_tool_permission`, `services/runner/src/mcp-permission.ts`). Reading the
 * server permission as the floor was D88 on the shipped path, and this adapter does not reopen it.
 *
 * So the default is written back into the slot it was read from: the floor while a table is
 * declared, the server permission otherwise. A default that did not change is not written at all,
 * which is what keeps opening a drawer and closing it from rewriting a policy.
 */
import type {GatewayPermission} from "../../gatewayTool/core/types"

import {
    isPerTool,
    isToolHidden,
    resolvedNewToolPermission,
    toolPermissions,
    type McpPermission,
    type McpServerPolicy,
} from "./toolPolicy"

/**
 * The saved policy shape the permission drawer edits.
 *
 * Structurally the `GatewayConnectionPermissions` declared in `@agenta/entity-ui`'s `toolUtils.ts`,
 * restated here because the dependency runs the other way: entity-ui imports this package. The two
 * are assignable in both directions and `mcpPolicyShapes.test.ts` in entity-ui holds them to it, so a
 * field added to one and not the other fails a test rather than diverging quietly.
 */
export interface GatewayConnectionPermissions {
    default: GatewayPermission
    tools: Record<string, GatewayPermission>
}

/**
 * Whether the drawer may offer "follows agent policy", at the server level and per tool.
 *
 * True, because absence expresses it at both levels. It stays a named constant rather than a fact
 * scattered through the drawer: the day the SDK's MCP `Permission` union gains a literal `inherit`,
 * the constant and the two branches below are the whole change.
 *
 * One combination it does not promise: an inherit default BESIDE a declared per-tool table. MCP has
 * no way to say "let the ladder decide for tools this table does not name" once a table exists, and
 * the product does not mean to. Declaring a table raises the floor to `ask` so a human sees a tool
 * nobody has looked at, which is what the drawer's own "Set permissions per tool" already writes.
 * Writing an inherit default against a declared table therefore reads back as `ask`, deliberately.
 */
export const MCP_SUPPORTS_INHERIT = true

const isMcpPermission = (value: GatewayPermission): value is McpPermission => value !== "inherit"

/**
 * The drawer's view of a saved MCP policy.
 *
 * `default` is what a tool with no entry of its own gets: the table's floor while a table is
 * declared, the server permission otherwise, and `inherit` when neither is written.
 */
export function toGatewayPermissions(policy: McpServerPolicy): GatewayConnectionPermissions {
    const floor = resolvedNewToolPermission(policy)
    return {
        default: floor ?? policy.permission ?? "inherit",
        tools: {...toolPermissions(policy)},
    }
}

/**
 * The saved policy an edited view produces, merged onto the policy it was read from.
 *
 * `current` carries everything the view has no room for: the tool filter, and the server permission
 * while the floor is what the view was showing. Dropping it would silently widen a filtered server.
 *
 * A value of `inherit` clears rather than writes, at both levels, which is the whole point of the
 * adapter. A tool the filter hides is not GIVEN a permission, matching `setToolPermission` and the
 * SDK validator that refuses the whole policy for such an entry; one that already carries a hidden
 * entry keeps it, because clearing a stranded entry has to stay possible (CR18).
 */
export function fromGatewayPermissions(
    permissions: GatewayConnectionPermissions,
    current: McpServerPolicy = {},
): McpServerPolicy {
    const existing = toolPermissions(current)
    const entries: Record<string, McpPermission> = {}
    for (const [name, value] of Object.entries(permissions.tools ?? {})) {
        if (!isMcpPermission(value)) continue
        if (isToolHidden(current, name) && !(name in existing)) continue
        entries[name] = value
    }

    const next: McpServerPolicy = {...current}
    if (Object.keys(entries).length) next.tool_permissions = entries
    else delete next.tool_permissions

    // Compare against the view of the policy as the tool edits leave it, not as it arrived:
    // emptying the table moves which slot governs, and a default measured against the old slot
    // would read as unchanged while meaning something else.
    if (permissions.default === toGatewayPermissions(next).default) return next

    if (isPerTool(next)) {
        if (permissions.default === "inherit") {
            delete next.new_tool_permission
            // Clearing the floor can hand the server permission back the governing slot, which
            // happens whenever the table went with it. Leaving it behind turned a pick of "ask
            // for write and delete" into the "allow" it was meant to replace, and the select
            // read back "Allow all" while the person had asked for the opposite.
            if (!isPerTool(next)) delete next.permission
        } else next.new_tool_permission = permissions.default
        return next
    }

    delete next.new_tool_permission
    if (permissions.default === "inherit") delete next.permission
    else next.permission = permissions.default
    return next
}
