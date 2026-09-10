/** The agent's default tool-permission policy, and what a human calls each value. */
export type PermissionPolicy = "allow_reads" | "allow" | "ask" | "deny"

export interface PermissionPolicyOption {
    value: PermissionPolicy
    label: string
    help: string
}

/**
 * The four policies, in the order the selector shows them. `help` is the sub-line under each label
 * on both hosts, so this list is the only place the wording lives.
 *
 * No option claims to be the default, because "the default" is two different policies here (#6662).
 * The standard template creates an agent on `allow`, while an agent whose config names no policy
 * runs on {@link DEFAULT_PERMISSION_POLICY}, and both surfaces show that fallback as the applied
 * value. A sub-line has no room to say which one it means, so it says neither.
 */
export const PERMISSION_POLICY_OPTIONS: PermissionPolicyOption[] = [
    {value: "allow_reads", label: "Allow reads", help: "Reads run, writes ask"},
    {value: "allow", label: "Allow all", help: "Every tool runs without asking"},
    {value: "ask", label: "Ask", help: "A human approves every tool call"},
    {value: "deny", label: "Deny all", help: "Every tool call is refused"},
]

/**
 * What the runner applies, and what both selectors display, when the config names no policy. NOT
 * what a new agent is created with: the standard template writes `allow` (`AgentTemplateSchema` in
 * the SDK), and #6641 deliberately left this fallback alone.
 */
export const DEFAULT_PERMISSION_POLICY: PermissionPolicy = "allow_reads"

const PERMISSION_POLICY_VALUES = new Set<string>(
    PERMISSION_POLICY_OPTIONS.map((option) => option.value),
)

export function isPermissionPolicy(value: unknown): value is PermissionPolicy {
    return typeof value === "string" && PERMISSION_POLICY_VALUES.has(value)
}

export const permissionPolicyLabel = (value: string | null | undefined): string | undefined =>
    PERMISSION_POLICY_OPTIONS.find((option) => option.value === value)?.label

/** The options a schema `enum` permits, or all of them when it names none. */
export function permissionPolicyOptionsForEnum(values: unknown): PermissionPolicyOption[] {
    if (!Array.isArray(values)) return PERMISSION_POLICY_OPTIONS
    const allowed = new Set(values.filter(isPermissionPolicy))
    return PERMISSION_POLICY_OPTIONS.filter((option) => allowed.has(option.value))
}
