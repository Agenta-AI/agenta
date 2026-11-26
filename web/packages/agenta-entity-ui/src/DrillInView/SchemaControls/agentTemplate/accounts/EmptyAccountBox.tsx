/** "No account yet" or "Not signed in yet": a filled row with a person tile and the action at the right. */
import type {ReactNode} from "react"

import {IconTile} from "@agenta/ui/ui"
import {UserCircle} from "@phosphor-icons/react"

export function EmptyAccountBox({text, children}: {text: string; children?: ReactNode}) {
    return (
        <div
            data-testid="empty-account-box"
            // Tone, not a dashed line (SURF-01): the same fill as the choice track above it.
            className="flex min-h-row-double items-center gap-3 rounded-lg bg-muted px-3 py-2"
        >
            <IconTile size={32} className="bg-background" aria-hidden>
                <UserCircle />
            </IconTile>
            <span className="min-w-0 flex-1 text-label leading-5 text-muted-foreground">{text}</span>
            {children}
        </div>
    )
}
