import {useCallback, useRef, type ReactElement} from "react"

import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "@agenta/ui/ui"

import {isMenuDivider, type SessionMenuEntry} from "./menu"

export interface SessionRowContextMenuProps {
    /** The row's verbs. Empty or absent renders the row bare — no menu, no wrapper. */
    entries?: SessionMenuEntry[]
    /**
     * Runs the verb. Return `true` when the verb PUT THE CARET SOMEWHERE ITSELF — the inline
     * rename editor is the only one that does.
     *
     * Radix returns focus to the trigger as the menu closes, which lands AFTER the editor's
     * `autoFocus`. The editor then blurs, and a blur commits and closes it — so "Rename" opened
     * an input the user never saw. A `true` here suppresses that one focus restore. Every other
     * verb keeps it, because returning the caret to the row is the correct behaviour for them.
     */
    onSelect?: (key: string) => boolean | void
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
    // Set during `onSelect`, read one tick later by `onCloseAutoFocus`. A ref, not state: the
    // close happens in the same commit as the select, so a re-render would be too late.
    const keepFocusRef = useRef(false)

    const handleSelect = useCallback(
        (key: string) => {
            keepFocusRef.current = onSelect?.(key) === true
        },
        [onSelect],
    )

    const handleCloseAutoFocus = useCallback((event: Event) => {
        if (keepFocusRef.current) event.preventDefault()
        keepFocusRef.current = false
    }, [])

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
