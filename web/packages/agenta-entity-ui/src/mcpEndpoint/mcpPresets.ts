/**
 * The default-permission presets for an MCP server, and the preset a saved policy reads back as.
 *
 * Two of the shared five mean something different here, and both used to be one wire shape:
 * nothing written at all. So picking "Ask for write and delete" saved nothing, and a server nobody
 * had configured read back as that preset, under a help line promising that its read-only tools run
 * automatically. Neither was true: with no policy written, the run's own permission ladder decides
 * every tool. Decision 45 separates them.
 *
 * - The absence has a preset of its own, "Follow agent policy", which is the spec's phrase for that
 *   state and the word its rollups and its per-tool value already use. Picking it clears everything.
 * - "Ask for write and delete" writes the shape its words describe: `askWritesPolicy` in
 *   `@agenta/entities` asks at the server, allows every read-only tool by name, and asks for
 *   anything the table does not name. It therefore needs the tool list, and is not offered until
 *   the list arrives.
 *
 * The other three are the shared table's, read from it rather than restated, so the four labels
 * these two features share cannot drift. The Integrations drawer is untouched: an integration
 * always carries a `default`, so the absence never reaches its select.
 */
import {
    isAskWritesPolicy,
    isAskWritesShape,
    toGatewayPermissions,
    type McpServerPolicy,
} from "@agenta/entities/mcpEndpoint"

import type {PermissionPresetOption} from "../DrillInView/SchemaControls/agentTemplate/IntegrationPermissionDrawer"
import {
    INTEGRATION_PRESETS,
    type PermissionPresetValue,
} from "../DrillInView/SchemaControls/integrationPolicy"
import type {GatewayPermission} from "../DrillInView/SchemaControls/toolUtils"

/** The preset whose saved value is the absence of a policy. */
export const FOLLOW_AGENT_PRESET = "follow_agent" as const

const shared = (value: PermissionPresetValue): {label: string; help: string} => {
    const def = INTEGRATION_PRESETS.find((candidate) => candidate.value === value)
    if (!def) throw new Error(`no preset named ${value}`)
    return {label: def.label, help: def.help}
}

/**
 * The menu, in order. "Follow agent policy" sits last among the pickable presets, where the
 * per-tool menu puts the same value, and Custom stays below the divider as the one thing a
 * non-empty per-tool table reads back as.
 *
 * Its help line states the one fact the absence carries, in the words the group rollups already
 * use for it.
 */
export const MCP_PRESETS: PermissionPresetOption[] = [
    {value: "always_ask", ...shared("always_ask")},
    {value: "ask_writes", ...shared("ask_writes")},
    {value: "allow_all", ...shared("allow_all")},
    {value: "deny_all", ...shared("deny_all")},
    {
        value: FOLLOW_AGENT_PRESET,
        label: "Follow agent policy",
        help: "Follows agent policy for every tool",
    },
    {value: "custom", ...shared("custom"), disabled: true, separatorBefore: true},
]

/** Which preset each governing value reads back as, where no table and no special shape decides. */
const BY_GOVERNING_VALUE: Record<GatewayPermission, PermissionPresetValue> = {
    ask: "always_ask",
    allow: "allow_all",
    deny: "deny_all",
    // Not "ask_writes". That preset now writes a shape of its own; the absence is its own preset.
    inherit: FOLLOW_AGENT_PRESET,
}

/** What the drawer knows about the server's advertised tools when it reads a policy. */
export interface McpToolListState {
    /** The advertised read-only tool names, or null while the list is not in hand. */
    names: string[] | null
    /** Whether a list is still on its way. False once one has arrived, or failed for good. */
    arriving: boolean
}

/**
 * The preset a saved MCP policy reads back as, with the number of per-tool rules behind it.
 *
 * A null preset means the answer is not knowable yet and the caller draws a pending control rather
 * than a preset. Exactly one policy is ever unknowable: the shape "Ask for write and delete"
 * writes. Naming that preset makes its help line's promise, that read-only tools run
 * automatically, and the same three fields also describe an always-ask server with one tool
 * allowed by hand. Reading it from the shape alone put that promise on a policy allowing the most
 * destructive tool a server has, for as long as the tool list took to arrive.
 *
 * Every other policy reads the same with the list or without it, so pending never stands in for an
 * answer this could give. Once a list has failed for good it is not coming, and the conservative
 * read stands: Custom says there are per-tool rules and claims nothing about which tools are reads.
 */
export function readMcpPreset(
    policy: McpServerPolicy,
    tools: McpToolListState,
): {preset: PermissionPresetValue | null; overrideCount: number} {
    const permissions = toGatewayPermissions(policy)
    const overrideCount = Object.keys(permissions.tools).length

    // Checked before Custom: this preset's whole point is that it declares a table, so a table
    // alone no longer means an author set tools one at a time.
    if (tools.names) {
        if (isAskWritesPolicy(policy, tools.names)) return {preset: "ask_writes", overrideCount}
    } else if (isAskWritesShape(policy)) {
        return {preset: tools.arriving ? null : "custom", overrideCount}
    }

    if (overrideCount > 0) return {preset: "custom", overrideCount}
    return {preset: BY_GOVERNING_VALUE[permissions.default], overrideCount: 0}
}

/** The presets a picked value writes with no help from the tool list. */
export const PRESET_PERMISSION: Partial<Record<PermissionPresetValue, GatewayPermission>> = {
    always_ask: "ask",
    allow_all: "allow",
    deny_all: "deny",
    // Absence is the value, and `fromGatewayPermissions` clears rather than writes it.
    [FOLLOW_AGENT_PRESET]: "inherit",
}
