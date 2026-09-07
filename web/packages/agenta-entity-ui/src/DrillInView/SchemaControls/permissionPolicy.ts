/**
 * The agent's default tool-permission policy.
 *
 * Shared by the config drawer's Permissions group and the chat composer's `/permissions` palette,
 * so both offer the same four policies under the same names — the palette is a shortcut to the
 * drawer's control, not a second opinion about what the policies are.
 */
import {permissionPolicyOptionsForEnum, type PermissionPolicyOption} from "@agenta/shared/utils"

export {
    DEFAULT_PERMISSION_POLICY,
    PERMISSION_POLICY_OPTIONS,
    isPermissionPolicy,
    permissionPolicyLabel,
    permissionPolicyOptionsForEnum,
} from "@agenta/shared/utils"
export type {PermissionPolicy, PermissionPolicyOption} from "@agenta/shared/utils"

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
