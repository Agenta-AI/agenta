/**
 * The agent's default tool-permission policy.
 *
 * Shared by the config drawer's Permissions group and the chat composer's `/permissions` palette,
 * so both offer the same four policies under the same names — the palette is a shortcut to the
 * drawer's control, not a second opinion about what the policies are.
 */
export type PermissionPolicy = "allow_reads" | "allow" | "ask" | "deny"

export interface PermissionPolicyOption {
    value: PermissionPolicy
    label: string
    help: string
}

export const PERMISSION_POLICY_OPTIONS: PermissionPolicyOption[] = [
    {value: "allow_reads", label: "Allow reads", help: "Reads run, writes ask; default"},
    {value: "allow", label: "Allow all", help: "Every tool runs without asking"},
    {value: "ask", label: "Ask", help: "A human approves every tool call"},
    {value: "deny", label: "Deny all", help: "Every tool call is refused"},
]

/** What the runner applies when the template names no policy. */
export const DEFAULT_PERMISSION_POLICY: PermissionPolicy = "allow_reads"

const PERMISSION_POLICY_VALUES = new Set<string>(
    PERMISSION_POLICY_OPTIONS.map((option) => option.value),
)

export function isPermissionPolicy(value: unknown): value is PermissionPolicy {
    return typeof value === "string" && PERMISSION_POLICY_VALUES.has(value)
}

export const permissionPolicyLabel = (value: string | null | undefined): string | undefined =>
    PERMISSION_POLICY_OPTIONS.find((option) => option.value === value)?.label

/**
 * The options a schema `enum` permits, or all of them when it names none. Every surface offering
 * policies goes through this — one that offered a value the schema forbids would write a draft
 * config the agent's own schema rejects.
 */
export function permissionPolicyOptionsForEnum(values: unknown): PermissionPolicyOption[] {
    if (!Array.isArray(values)) return PERMISSION_POLICY_OPTIONS
    const allowed = new Set(values.filter(isPermissionPolicy))
    return PERMISSION_POLICY_OPTIONS.filter((option) => allowed.has(option.value))
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null

/**
 * The `runner.permissions.default` node of a PARAMETERS schema, tolerating the `agent` wrapper the
 * same way `locateTemplate` does. Null when the schema does not declare the field — which is what
 * the drawer keys on to hide its control entirely.
 */
export function permissionPolicySchema(schema: unknown): Record<string, unknown> | null {
    const props = (node: unknown) => asRecord(asRecord(node)?.properties)
    const root = props(schema)
    if (!root) return null
    const template = props(root.agent) ?? root
    const runner = props(template.runner)
    const permissions = runner ? props(runner.permissions) : null
    return permissions ? asRecord(permissions.default) : null
}

/** The options a parameters schema permits for `runner.permissions.default`. */
export const permissionPolicyOptionsForSchema = (schema: unknown): PermissionPolicyOption[] =>
    permissionPolicyOptionsForEnum(permissionPolicySchema(schema)?.enum)
