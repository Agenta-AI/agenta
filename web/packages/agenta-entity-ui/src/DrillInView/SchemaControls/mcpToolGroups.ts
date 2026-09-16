/**
 * One MCP server's tools as the permission drawer draws them: two groups, each with its rollup.
 *
 * Every rule here is already written once, for integrations, in `integrationPolicy.ts`. This file
 * composes those functions over MCP data rather than restating them, because the drawer is one
 * component with two callers and a second copy of "what counts as read-only" or "what a mixed group
 * says" is a copy that drifts from the surface it is supposed to describe.
 *
 * The translation in front of them is the adapter in `@agenta/entities`: an MCP policy has a
 * different saved shape and spells `inherit` as an absent value. Nothing here resolves a permission;
 * the runner is still the only place that does.
 */
import {
    fromGatewayPermissions,
    toCatalogTools,
    toGatewayPermissions,
    type GatewayConnectionPermissions as McpGatewayPermissions,
    type McpServerPolicy,
    type McpToolSummary,
} from "@agenta/entities/mcpEndpoint"

import {
    partitionToolsByAccess,
    rollupGroupPermission,
    rollupLabel,
    withStaleTools,
    type CatalogToolInfo,
    type GroupRollup,
} from "./integrationPolicy"
import type {GatewayConnectionPermissions} from "./toolUtils"

export type McpToolAccess = "read_only" | "write"

export interface McpToolGroup {
    access: McpToolAccess
    /** The header, as decision 27 fixes it: sentence case, the count after a middle dot. */
    label: string
    tools: CatalogToolInfo[]
    rollup: GroupRollup
    /** What the header's trailing text says: "runs automatically", "mixed", and the rest. */
    rollupLabel: string
}

const GROUP_TITLES: Record<McpToolAccess, string> = {
    read_only: "Read-only",
    write: "Write",
}

const group = (
    access: McpToolAccess,
    tools: CatalogToolInfo[],
    permissions: GatewayConnectionPermissions,
): McpToolGroup => {
    const rollup = rollupGroupPermission(
        tools.map((tool) => tool.key),
        permissions,
    )
    return {
        access,
        label: `${GROUP_TITLES[access]} · ${tools.length}`,
        tools,
        rollup,
        rollupLabel: rollupLabel(rollup),
    }
}

/**
 * The drawer's whole view of one server: the policy in the shape it edits, and the two groups.
 *
 * A saved key the server has stopped advertising keeps a row of its own, marked stale, rather than
 * disappearing: it is still an authored decision, and a view that hides it would erase it on the
 * next write. It lands in the write group, because nothing says it is a read.
 *
 * Call this with a COMPLETE catalogue. Against a half-loaded one every key not yet fetched reads as
 * stale, which is the same caveat `withStaleTools` carries.
 */
export function mcpToolGroups(
    tools: McpToolSummary[],
    policy: McpServerPolicy,
): {permissions: McpGatewayPermissions; groups: McpToolGroup[]} {
    const permissions = toGatewayPermissions(policy)
    const catalog = withStaleTools(toCatalogTools(tools), permissions)
    const {readOnly, write} = partitionToolsByAccess(catalog)

    return {
        permissions,
        groups: [group("read_only", readOnly, permissions), group("write", write, permissions)],
    }
}

/** The policy to save after the drawer changed one value. Named so the write path is one call. */
export function mcpPolicyFromPermissions(
    permissions: McpGatewayPermissions,
    current: McpServerPolicy,
): McpServerPolicy {
    return fromGatewayPermissions(permissions, current)
}
