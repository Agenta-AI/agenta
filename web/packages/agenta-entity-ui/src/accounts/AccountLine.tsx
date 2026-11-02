/**
 * The tertiary "When you run it: …" line of a "user" item, shared by the item drawers and
 * "Attach a secret".
 */
import type {ComponentProps, ReactNode} from "react"

import {Button} from "@agenta/ui/ui"

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
