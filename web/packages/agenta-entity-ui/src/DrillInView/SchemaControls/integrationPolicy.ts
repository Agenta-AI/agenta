/**
 * The authoring model for one integration's permission policy: the presets (contracts section 10),
 * the four per-tool values, and the derived views the permission drawer shows — the read-only
 * partition, the group rollups, and the stale-key list.
 *
 * A preset is a DISPLAY of the saved shape, never a saved value. Writing one sets
 * `permissions.default` and clears `permissions.tools`; reading one maps the saved shape back.
 * Setting any per-tool value makes the shown preset Custom, because `tools` is no longer empty.
 *
 * The override count is the NUMBER OF SAVED ENTRIES in `tools`, including an entry whose value
 * happens to equal the current default. Counting only entries that differ from the preset would
 * disagree with the Custom label itself, and could show "Custom" with a count of zero.
 *
 * Pure translation only — no React, and nothing here resolves `inherit`. The runner is the only
 * place that computes an effective permission; a second copy of the compiler in TypeScript would
 * read an agent-wide mode this module does not own and the two would drift.
 */
import type {GatewayConnectionPermissions, GatewayPermission} from "./toolUtils"

export type IntegrationPreset = "always_ask" | "ask_writes" | "allow_all" | "deny_all" | "custom"

export interface IntegrationPresetDef {
    value: IntegrationPreset
    /** Label in the drawer's default-permission select. */
    label: string
    /** One-line description under the label in the open menu. */
    help: string
    /** Short label on the integration row in the tools section. */
    rowLabel: string
    /** The `default` this preset saves. Null for Custom, which leaves the default unchanged. */
    permission: GatewayPermission | null
}

/** Menu order, as the design board fixes it. Custom sits below a divider. */
export const INTEGRATION_PRESETS: IntegrationPresetDef[] = [
    {
        value: "always_ask",
        label: "Always ask",
        help: "Approval before every run",
        rowLabel: "Always asks",
        permission: "ask",
    },
    {
        value: "ask_writes",
        label: "Ask for write and delete",
        help: "Read-only tools run automatically",
        rowLabel: "Allow reads",
        permission: "inherit",
    },
    {
        value: "allow_all",
        label: "Allow all",
        help: "Everything runs without asking",
        rowLabel: "Allow all",
        permission: "allow",
    },
    {
        value: "deny_all",
        label: "Deny all",
        help: "Tools stay listed but never run",
        rowLabel: "Denied",
        permission: "deny",
    },
    {
        value: "custom",
        label: "Custom",
        help: "Per-tool permissions below",
        rowLabel: "Custom",
        permission: null,
    },
]

/** A newly added integration lands on "Ask for write and delete". */
export const DEFAULT_INTEGRATION_PRESET: IntegrationPreset = "ask_writes"

const integrationPresetDef = (preset: IntegrationPreset): IntegrationPresetDef =>
    INTEGRATION_PRESETS.find((def) => def.value === preset) ??
    (INTEGRATION_PRESETS.find(
        (def) => def.value === DEFAULT_INTEGRATION_PRESET,
    ) as IntegrationPresetDef)

/** The policy a newly added integration is saved with. */
export const DEFAULT_INTEGRATION_PERMISSIONS: GatewayConnectionPermissions = {
    default: integrationPresetDef(DEFAULT_INTEGRATION_PRESET).permission ?? "inherit",
    tools: {},
}

/**
 * The permissions a preset saves. Picking a preset CLEARS the per-tool map, which is what returns
 * an integration from Custom to a single rule. Custom is not writable: it is what a non-empty map
 * reads back as, so it returns `current` untouched.
 */
export function presetPermissions(
    preset: IntegrationPreset,
    current: GatewayConnectionPermissions,
): GatewayConnectionPermissions {
    const def = integrationPresetDef(preset)
    if (!def.permission) return current
    return {default: def.permission, tools: {}}
}

export interface ReadPresetResult {
    preset: IntegrationPreset
    /** Saved entries in `tools`. Zero for every preset but Custom. */
    overrideCount: number
}

/** The preset a saved policy reads back as, with its override count. */
export function readIntegrationPreset(permissions: GatewayConnectionPermissions): ReadPresetResult {
    const overrideCount = Object.keys(permissions.tools).length
    if (overrideCount > 0) return {preset: "custom", overrideCount}
    const def = INTEGRATION_PRESETS.find((d) => d.permission === permissions.default)
    return {preset: def?.value ?? "ask_writes", overrideCount: 0}
}

/** A policy as a row shows it: the preset it reads back as, and the preset's short label with the
 *  override count appended for Custom. Returns both, so a caller never reads the preset twice. */
export function integrationPermissionSummary(permissions: GatewayConnectionPermissions): {
    preset: IntegrationPreset
    label: string
} {
    const {preset, overrideCount} = readIntegrationPreset(permissions)
    const {rowLabel} = integrationPresetDef(preset)
    return {preset, label: preset === "custom" ? `${rowLabel} · ${overrideCount}` : rowLabel}
}

// ---------------------------------------------------------------------------
// Per-tool values and group rollups
// ---------------------------------------------------------------------------

export interface ToolPermissionOption {
    value: GatewayPermission
    label: string
    help: string
}

/**
 * The four per-tool values. "Follow agent policy" is the saved value `inherit`: migration writes it
 * for every legacy tool that carried no explicit permission, so without it a migrated row would
 * hold a value the select cannot show and an author could not restore once they changed it.
 */
export const TOOL_PERMISSION_OPTIONS: ToolPermissionOption[] = [
    {value: "ask", label: "Always ask", help: "Approval before every run"},
    {value: "allow", label: "Allow", help: "Runs without asking"},
    {value: "deny", label: "Deny", help: "Never runs"},
    {value: "inherit", label: "Follow agent policy", help: "Uses the agent's permission policy"},
]

/** The value saved for one tool: its own entry, else the entry's default. */
export function savedToolPermission(
    permissions: GatewayConnectionPermissions,
    toolKey: string,
): GatewayPermission {
    return permissions.tools[toolKey] ?? permissions.default
}

/**
 * Set one tool's value, keeping the default and every other tool. The entry is saved even when it
 * equals the current default: the author set it deliberately, it survives a later change of
 * default, and it is what keeps the override count and the Custom label saying the same thing.
 *
 * The one place that per-tool merge is written. Every writer goes through it, so the drawer, the
 * config write-through, and the tests cannot drift apart.
 */
export function mergeToolPermission(
    permissions: GatewayConnectionPermissions,
    toolKey: string,
    permission: GatewayPermission,
): GatewayConnectionPermissions {
    return {default: permissions.default, tools: {...permissions.tools, [toolKey]: permission}}
}

/** One catalog tool, reduced to what the drawer needs. */
export interface CatalogToolInfo {
    key: string
    name?: string
    description?: string
    /** `true` is a read, `false` is a write. Absent means unknown. */
    readOnly?: boolean
    /** The key is saved on the entry but the provider catalog no longer lists it. */
    stale?: boolean
}

export interface ToolPartition {
    readOnly: CatalogToolInfo[]
    write: CatalogToolInfo[]
}

/** Split the catalog into the drawer's two groups. An absent `read_only` flag lands in write. */
export function partitionToolsByAccess(tools: CatalogToolInfo[]): ToolPartition {
    const readOnly: CatalogToolInfo[] = []
    const write: CatalogToolInfo[] = []
    for (const tool of tools) (tool.readOnly === true ? readOnly : write).push(tool)
    return {readOnly, write}
}

/**
 * The catalog the drawer lists: every tool the provider reports, plus a row for every saved key it
 * no longer lists. A key that left the catalog is still an authored intent, so it stays visible and
 * editable, marked stale. Dropping it would hide the intent and the next write would erase it.
 *
 * Call this only with a COMPLETE catalog. Against a half-loaded one, every key not yet fetched
 * would be marked stale.
 */
export function withStaleTools(
    catalog: CatalogToolInfo[],
    permissions: GatewayConnectionPermissions,
): CatalogToolInfo[] {
    const known = new Set(catalog.map((tool) => tool.key))
    const stale = Object.keys(permissions.tools)
        .filter((key) => !known.has(key))
        .map((key) => ({key, stale: true}))
    return [...catalog, ...stale]
}

export type GroupRollup =
    | {kind: "shared"; permission: GatewayPermission}
    | {kind: "mixed"}
    | {kind: "empty"}

/**
 * What a group header summarizes: the SAVED values of the tools inside it, one shared value when
 * they agree and mixed when they do not. Never resolves `inherit`.
 */
export function rollupGroupPermission(
    toolKeys: string[],
    permissions: GatewayConnectionPermissions,
): GroupRollup {
    if (toolKeys.length === 0) return {kind: "empty"}
    let shared: GatewayPermission | null = null
    for (const key of toolKeys) {
        const value = savedToolPermission(permissions, key)
        if (shared === null) shared = value
        else if (shared !== value) return {kind: "mixed"}
    }
    return {kind: "shared", permission: shared as GatewayPermission}
}

const ROLLUP_LABELS: Record<GatewayPermission, string> = {
    inherit: "follows agent policy",
    allow: "runs automatically",
    ask: "asks first",
    deny: "never runs",
}

export function rollupLabel(rollup: GroupRollup): string {
    if (rollup.kind === "mixed") return "mixed"
    if (rollup.kind === "empty") return ""
    return ROLLUP_LABELS[rollup.permission]
}
