/**
 * The agent's default tool-permission policy.
 *
 * Shared by the config drawer's Permissions group and the chat composer's `/permissions` palette,
 * so both offer the same four policies under the same names — the palette is a shortcut to the
 * drawer's control, not a second opinion about what the policies are.
 */
import {createT, type CatalogKey} from "@agenta/i18n"
import permissionPolicyCatalog from "@agenta/i18n/catalogs/shared.permissionPolicy"
import {
    isPermissionPolicy,
    permissionPolicyOptionsForEnum as englishOptionsForEnum,
    type PermissionPolicy,
    type PermissionPolicyOption,
} from "@agenta/shared/utils"

export {DEFAULT_PERMISSION_POLICY, PERMISSION_POLICY_OPTIONS} from "@agenta/shared/utils"
export {isPermissionPolicy}
export type {PermissionPolicy, PermissionPolicyOption} from "@agenta/shared/utils"

const tNow = createT(permissionPolicyCatalog)
type PolicyKey = CatalogKey<typeof permissionPolicyCatalog>

/** Display text per stored value. The stored value itself is never translated. */
const POLICY_TEXT: Record<PermissionPolicy, {label: PolicyKey; help: PolicyKey}> = {
    allow_reads: {
        label: "shared.permissionPolicy.allowReads",
        help: "shared.permissionPolicy.allowReadsHelp",
    },
    allow: {
        label: "shared.permissionPolicy.allowAll",
        help: "shared.permissionPolicy.allowAllHelp",
    },
    ask: {label: "shared.permissionPolicy.ask", help: "shared.permissionPolicy.askHelp"},
    deny: {label: "shared.permissionPolicy.denyAll", help: "shared.permissionPolicy.denyAllHelp"},
}

const translated = (option: PermissionPolicyOption): PermissionPolicyOption => ({
    value: option.value,
    label: tNow(POLICY_TEXT[option.value].label),
    help: tNow(POLICY_TEXT[option.value].help),
})

/** What a human calls a policy value, in the active language. */
export const permissionPolicyLabel = (value: string | null | undefined): string | undefined => {
    return isPermissionPolicy(value) ? tNow(POLICY_TEXT[value].label) : undefined
}

/** The options a schema `enum` permits, or all of them when it names none, in the active language. */
export const permissionPolicyOptionsForEnum = (values: unknown): PermissionPolicyOption[] =>
    englishOptionsForEnum(values).map(translated)

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
