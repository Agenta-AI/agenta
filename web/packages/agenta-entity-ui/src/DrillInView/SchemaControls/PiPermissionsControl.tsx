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

export interface PiPermissionsControlProps {
    /** The harness `permissions` object (`harness.permissions`); may be absent. */
    value?: Record<string, unknown> | null
    /** Called with the next `harness.permissions` object. */
    onChange: (permissions: Record<string, unknown>) => void
    disabled?: boolean
}

const RULE_OPTIONS = [...PI_BUILTIN_RULE_NAMES]

const ROWS: {list: PiPermissionList; label: string; help: string}[] = [
    {list: "allow", label: "Allow", help: "Tools that run without asking."},
    {list: "ask", label: "Ask", help: "Tools that ask before running."},
    {list: "deny", label: "Deny", help: "Tools that are never allowed to run."},
]

export const PiPermissionsControl = memo(function PiPermissionsControl({
    value,
    onChange,
    disabled = false,
}: PiPermissionsControlProps) {
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
                    label={railInfoLabel(label, help)}
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
