/**
 * A session menu row that names its key on the right, the way a desktop menu does.
 *
 * Lives here so every session menu — the desktop playground's tab bar, the shared tab rail — prints
 * the same row shape from the same registry entry. The wrapper has to grow inside the menu item's
 * own flex row, or the keycap sits against the label instead.
 */
import type {ReactNode} from "react"

import {ShortcutKeys} from "@agenta/ui/shortcuts"

export const withShortcutKey = (label: ReactNode, shortcutId: string): ReactNode => (
    <span className="flex min-w-0 flex-1 items-center gap-6">
        <span className="min-w-0 flex-1">{label}</span>
        <ShortcutKeys id={shortcutId} />
    </span>
)
