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

/** Menu keys whose shortcut acts on the ACTIVE session, and the binding each one names. */
const ACTIVE_ONLY_SHORTCUTS: Record<string, string> = {
    rename: "session.rename",
    archive: "session.archive",
}

/**
 * Name the keyboard shortcut on a session menu's rows — but only on the ACTIVE session's menu.
 *
 * `Alt+R` and `Alt+A` act on whichever session is active, never on the row whose menu is open
 * (`useSessionShortcuts`). Printing the keycap on every row taught the opposite: open the menu on
 * another tab, read "Archive ⌥A", press it, and the ACTIVE session is archived instead (#6842).
 *
 * Shared so the desktop tab bar and the tab rail cannot drift on which rows earn a keycap.
 */
export const withSessionShortcutKeys = <T,>(
    entries: readonly T[],
    {isActive}: {isActive: boolean},
): T[] =>
    entries.map((entry) => {
        if (!isActive) return entry
        // Menu entries are a union across surfaces — antd items here, `SessionMenuEntry` there,
        // and a divider carries no key at all. The shape this needs is the same in all of them.
        const row = entry as {key?: unknown; label?: ReactNode}
        const shortcutId = typeof row.key === "string" ? ACTIVE_ONLY_SHORTCUTS[row.key] : undefined
        return shortcutId ? ({...entry, label: withShortcutKey(row.label, shortcutId)} as T) : entry
    })
