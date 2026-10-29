/**
 * The "Account" block at the top of an item's drawer: a label, a select and one tertiary line
 * under it. Styled exactly like the drawer's own "Default permission" block, because it is that
 * block's sibling (approved board `editor-gmail-permissions`).
 */
import type {ComponentProps, ReactNode} from "react"

import {Button} from "@agenta/ui/ui"

import {PermissionPolicySelect, type PermissionPolicyOption} from "../PermissionPolicySelect"

import {ACCOUNT_COPY} from "./copy"

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

/** "When you run it: …" with its actions, in the drawer's tertiary line style. */
export function AccountLine({text, children}: {text: string; children?: ReactNode}) {
    return (
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5">
            <span className="min-w-0 text-xs text-[var(--ag-colorTextTertiary)]">{text}</span>
            {children}
        </div>
    )
}

/**
 * One link-style action on the line ("Change", "Sign out", "Sign in"). Every prop reaches the
 * button, so it can be a menu trigger.
 */
export function AccountLineAction(props: ComponentProps<typeof Button>) {
    return <Button type="button" variant="link" size="xs" className="p-0 text-xs" {...props} />
}
