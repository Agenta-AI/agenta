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
 * Exactly ONE option says "default", and it is the policy a NEW agent is created with — `allow`
 * since #6641. That is a different question from {@link DEFAULT_PERMISSION_POLICY}, which is the
 * fallback the runner applies to a template that names no policy at all. A reader of the dropdown
 * is choosing a policy for an agent, so the word describes what they would have got by doing
 * nothing (#6662).
 */
export const PERMISSION_POLICY_OPTIONS: PermissionPolicyOption[] = [
    {value: "allow_reads", label: "Allow reads", help: "Reads run, writes ask"},
    {value: "allow", label: "Allow all", help: "Every tool runs without asking; default"},
    {value: "ask", label: "Ask", help: "A human approves every tool call"},
    {value: "deny", label: "Deny all", help: "Every tool call is refused"},
]

/**
 * What the runner applies when the template names no policy. NOT what a new agent is created with
 * (that is `allow`, written into the template by the SDK since #6641) — this is only the fallback
 * for a template with no `runner.permissions.default` at all, which #6641 deliberately left alone.
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
