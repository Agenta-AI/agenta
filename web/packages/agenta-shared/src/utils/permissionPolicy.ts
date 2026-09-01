/**
 * The agent's default tool-permission policy: the values, and what a human calls them.
 *
 * Lives in `shared` because three layers need the same four names — the config drawer's
 * Permissions group, the chat composer's `/permissions` palette, and the commit diff, which
 * would otherwise print the raw enum (`allow_reads`) at the reader.
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
