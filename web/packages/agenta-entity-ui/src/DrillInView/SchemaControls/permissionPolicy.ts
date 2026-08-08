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
