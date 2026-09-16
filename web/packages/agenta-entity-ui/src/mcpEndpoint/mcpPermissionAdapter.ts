/**
 * Translating one MCP server's saved policy into the shape the permission drawer authors, and back.
 *
 * The drawer was written for a Composio integration, whose policy is `{default, tools{}}` over the
 * four values `inherit · allow · ask · deny`. An MCP server saves `{permission, tool_permissions{},
 * new_tool_permission}` over three, `allow · ask · deny`, mirroring `MCPPolicy` in
 * `sdks/python/agenta/sdk/agents/mcp/models.py`.
 *
 * THE MISSING FOURTH VALUE IS NOT MISSING. `inherit` is not a value on the MCP wire; it is the
 * ABSENCE of one. A server with no `permission` follows the agent's policy, and a tool with no
 * entry in `tool_permissions` follows whatever answers for a tool the table does not name. So the
 * round trip is lossless in both directions without the SDK gaining a fourth value, and without
 * any preset being disabled.
 *
 * Nothing here resolves a permission. `inheritedPermission` reports what the RUN would do for an
 * unnamed tool, which is a label, not a decision: the runner remains the only place an effective
 * permission is computed.
 *
 * WP1 is landing the same translation in `@agenta/entities/mcpEndpoint` as `policyAdapter.ts` and
 * `toolCatalog.ts`. When it does, this file becomes a re-export of those two and every caller stays
 * as it is.
 */
import {
    isPerTool,
    toolPermissions,
    type McpPermission,
    type McpServerPolicy,
    type McpToolSummary,
} from "@agenta/entities/mcpEndpoint"

import type {CatalogToolInfo} from "../DrillInView/SchemaControls/integrationPolicy"
import type {
    GatewayConnectionPermissions,
    GatewayPermission,
} from "../DrillInView/SchemaControls/toolUtils"

/**
 * What a tool list carries once WP1 stops discarding it at `readToolPage`.
 *
 * Declared here as a widening rather than read off `McpToolSummary`, so this package compiles
 * against today's narrow summary and needs no change when the wider one lands.
 */
export interface McpToolAnnotations {
    readOnlyHint?: boolean
    destructiveHint?: boolean
}

export type McpAnnotatedTool = McpToolSummary & {
    title?: string
    annotations?: McpToolAnnotations
}

/**
 * The drawer's catalog rows.
 *
 * `title` wins over `name` for what a person reads, which is the server's own rule, while the KEY
 * stays the name the server advertises: that is the spelling the policy is keyed by and the only
 * one every harness agrees on.
 *
 * `readOnlyHint` maps to `readOnly`, and an ABSENT hint stays absent rather than becoming `false`,
 * because `partitionToolsByAccess` already puts an unknown flag in the write group. A tool that
 * does not say it is safe is not safe.
 */
export function toCatalogTools(tools: McpAnnotatedTool[]): CatalogToolInfo[] {
    return tools.map((tool) => ({
        key: tool.name,
        name: tool.title || tool.name,
        description: tool.description,
        readOnly: tool.annotations?.readOnlyHint,
    }))
}

/** The saved MCP policy, as the drawer reads it. An absent value is `inherit` on both levels. */
export function toGatewayPermissions(policy: McpServerPolicy): GatewayConnectionPermissions {
    return {
        default: policy.permission ?? "inherit",
        tools: {...toolPermissions(policy)},
    }
}

/**
 * The drawer's policy, written back onto the MCP one.
 *
 * `current` is carried through rather than rebuilt: `tools` is the server's include FILTER, not a
 * permission, and nothing in this drawer edits it. Dropping it here would quietly widen what the
 * server advertises.
 *
 * An empty table takes `new_tool_permission` with it. With no per-tool entries left there is no
 * table for a floor to belong to, and leaving one behind would keep the per-tool mode switched on
 * for a server whose author has just returned it to a single rule.
 */
export function fromGatewayPermissions(
    next: GatewayConnectionPermissions,
    current: McpServerPolicy,
): McpServerPolicy {
    const policy: McpServerPolicy = {...current}

    if (next.default === "inherit") delete policy.permission
    else policy.permission = next.default

    const table: Record<string, McpPermission> = {}
    for (const [key, value] of Object.entries(next.tools)) {
        // An entry whose value is `inherit` is an entry that should not exist: on this wire the
        // absence IS the value.
        if (value === "inherit") continue
        table[key] = value as McpPermission
    }

    if (Object.keys(table).length > 0) {
        policy.tool_permissions = table
    } else {
        delete policy.tool_permissions
        delete policy.new_tool_permission
    }

    return policy
}

/**
 * What a tool carrying no rule of its own actually gets when the agent runs.
 *
 * Once a per-tool table is declared, the runner's gate answers `ask` for anything the table does
 * not name, from `new_tool_permission` or from the `ask` floor, and NEVER from the whole-server
 * permission: a human decides for a tool nobody has looked at. Reading the server permission here
 * would promise that an `allow` server runs an unnamed tool unapproved, which is both the unsafe
 * direction and not what the run does (D88).
 */
export function inheritedPermission(policy: McpServerPolicy): McpPermission {
    if (isPerTool(policy)) return policy.new_tool_permission ?? "ask"
    return policy.permission ?? "ask"
}

/** The per-tool select's `inherit` row, carrying the provenance a bare value would not have. */
export function inheritOptionLabel(policy: McpServerPolicy): string {
    return `Inherits ${inheritedPermission(policy)}`
}

/** A saved value, as the drawer's four-value vocabulary spells it. */
export const toGatewayPermission = (
    permission: McpPermission | null | undefined,
): GatewayPermission => permission ?? "inherit"
