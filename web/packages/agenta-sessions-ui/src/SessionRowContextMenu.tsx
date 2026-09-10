import type {ReactElement} from "react"

import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "@agenta/ui/ui"

import {isMenuDivider, type SessionMenuEntry} from "./menu"
import {useDeferredMenuSelect, type MenuSelect} from "./useDeferredMenuSelect"

export interface SessionRowContextMenuProps {
    /** The row's verbs. Empty or absent renders the row bare — no menu, no wrapper. */
    entries?: SessionMenuEntry[]
    /** Runs the verb. Return a function to defer it until the menu closes — see
     * `useDeferredMenuSelect`, which the row kebab shares. */
    onSelect?: MenuSelect
    /** The row itself; it becomes the trigger, so it must forward a ref (`asChild`). */
    children: ReactElement
}

/**
 * Right-click (or long-press) verbs on a session row.
 *
 * One wrapper for every session surface — the card lists and the standalone lists — so a row
 * offers the same actions wherever it is rendered.
 */
export const SessionRowContextMenu = ({
    entries,
    onSelect,
    children,
}: SessionRowContextMenuProps) => {
    const {handleSelect, handleCloseAutoFocus} = useDeferredMenuSelect(onSelect)

    if (!entries || entries.length === 0) return children

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
            <ContextMenuContent onCloseAutoFocus={handleCloseAutoFocus}>
                {entries.map((entry, index) =>
                    isMenuDivider(entry) ? (
                        <ContextMenuSeparator key={`divider-${index}`} />
                    ) : (
                        <ContextMenuItem
                            key={entry.key}
                            disabled={entry.disabled}
                            variant={entry.danger ? "destructive" : undefined}
                            onSelect={() => handleSelect(entry.key)}
                        >
                            {entry.icon ? (
                                <span className="flex shrink-0 items-center">{entry.icon}</span>
                            ) : null}
                            {entry.label}
                        </ContextMenuItem>
                    ),
                )}
            </ContextMenuContent>
        </ContextMenu>
    )
}
