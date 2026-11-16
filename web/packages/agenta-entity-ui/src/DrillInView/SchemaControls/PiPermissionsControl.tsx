/**
 * PiPermissionsControl
 *
 * The Pi harness's three permission rule lists, persisted in the first-class
 * `harness.permissions` slice (`{allow, ask, deny}`). Pi built-in tools are always active and are
 * never configured in `tools`, so these lists are the only lever over them; the runner matches a
 * built-in rule case-insensitively and also accepts a `Tool(prefix:*)` pattern.
 *
 * Each list is a tag select seeded with the seven canonical names, and any free-typed value is
 * kept verbatim so pattern rules and custom tool names survive. The select splits on nothing but
 * Enter: a prefix pattern's body may contain a comma (`Bash(echo a,b:*)`) and must reach the
 * runner whole. A grant made from an approval card's "Always allow" lands in the allow list and
 * is removable here.
 */
import {memo, useCallback, useMemo} from "react"

import {RailField, railInfoLabel} from "../../drawers/shared/RailField"
import {ChipsInput} from "../../gatewayTool/components/schemaFormControls"

import {
    PI_BUILTIN_RULE_NAMES,
    readPiPermissionRules,
    writePiPermissionRules,
    type PiPermissionList,
} from "./piPermissions"
import {useT, type CatalogKey} from "@agenta/i18n"
import permissionsCatalog from "@agenta/i18n/catalogs/entityUi.permissions"

export interface PiPermissionsControlProps {
    /** The harness `permissions` object (`harness.permissions`); may be absent. */
    value?: Record<string, unknown> | null
    /** Called with the next `harness.permissions` object. */
    onChange: (permissions: Record<string, unknown>) => void
    disabled?: boolean
}

const RULE_OPTIONS = [...PI_BUILTIN_RULE_NAMES]

const ROWS: {
    list: PiPermissionList
    label: CatalogKey<typeof permissionsCatalog>
    help: CatalogKey<typeof permissionsCatalog>
}[] = [
    {list: "allow", label: "entityUi.permissions.allow", help: "entityUi.permissions.allowHelp"},
    {list: "ask", label: "entityUi.permissions.ask", help: "entityUi.permissions.askHelp"},
    {list: "deny", label: "entityUi.permissions.deny", help: "entityUi.permissions.denyHelp"},
]

export const PiPermissionsControl = memo(function PiPermissionsControl({
    value,
    onChange,
    disabled = false,
}: PiPermissionsControlProps) {
    const t = useT(permissionsCatalog)
    const current = useMemo(() => readPiPermissionRules(value), [value])

    const write = useCallback(
        (list: PiPermissionList, rules: string[]) =>
            onChange(writePiPermissionRules(value, list, rules)),
        [value, onChange],
    )

    return (
        <>
            {ROWS.map(({list, label, help}) => (
                <RailField
                    key={list}
                    // The path the commit-diff classifier emits for this list, so an approval
                    // card's "Always allow" grant marks the row it actually wrote to.
                    path={`harness.permissions.${list}`}
                    label={railInfoLabel(t(label), t(help))}
                >
                    <ChipsInput
                        value={current[list]}
                        onChange={(rules) => write(list, rules ?? [])}
                        options={RULE_OPTIONS}
                        placeholder="Bash(npm run:*)"
                        disabled={disabled}
                    />
                </RailField>
            ))}
        </>
    )
})
