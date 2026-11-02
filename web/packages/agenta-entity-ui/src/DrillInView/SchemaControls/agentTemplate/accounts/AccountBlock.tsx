/**
 * The "Account" block at the top of an item's drawer: a label, a select and one tertiary line
 * under it. Styled exactly like the drawer's own "Default permission" block, because it is that
 * block's sibling (approved board `editor-gmail-permissions`).
 */
import type {ReactNode} from "react"

import {ACCOUNT_COPY} from "../../../../accounts/copy"
import {PermissionPolicySelect, type PermissionPolicyOption} from "../PermissionPolicySelect"

export function AccountBlock({
    value,
    options,
    onChange,
    disabled,
    line,
}: {
    value: string
    options: PermissionPolicyOption[]
    onChange: (value: string) => void
    disabled?: boolean
    /** The "When you run it" line, or nothing. */
    line?: ReactNode
}) {
    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--ag-colorTextSecondary)]">
                {ACCOUNT_COPY.label}
            </span>
            <PermissionPolicySelect
                value={value}
                onChange={onChange}
                options={options}
                disabled={disabled}
                aria-label={ACCOUNT_COPY.label}
            />
            {line}
        </div>
    )
}
