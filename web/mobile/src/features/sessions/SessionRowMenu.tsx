import {
    isMenuDivider,
    useDeferredMenuSelect,
    type MenuSelect,
    type SessionMenuEntry,
} from "@agenta/sessions-ui"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {DotsThreeVertical} from "@phosphor-icons/react"

import {Button} from "@/components/ui/button"

/**
 * A session row's kebab — the shared verbs (rename, pin, archive, delete, and an automation
 * row's own) as this list's only per-row control.
 *
 * The entries arrive already resolved by `useSessionRowMenu`, so this never learns what a verb
 * means; it renders the neutral shape and hands the key back. `useDeferredMenuSelect` is what
 * lets "Rename" work: the row's editor must not mount inside the menu's focus trap, so a select
 * that returns a function has it run once the menu has closed.
 */
export const SessionRowMenu = ({
    entries,
    onSelect,
    label,
}: {
    entries: SessionMenuEntry[]
    onSelect: MenuSelect
    /** Names the session, so a screen reader hears which row's actions these are. */
    label: string
}) => {
    const {handleSelect, handleCloseAutoFocus} = useDeferredMenuSelect(onSelect)

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    // The same 24px column and the same glyph the automations list's row kebab
                    // sits in, so the two tables' last column lines up.
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Actions for ${label}`}
                    className="text-muted-foreground"
                >
                    <DotsThreeVertical size={16} weight="bold" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onCloseAutoFocus={handleCloseAutoFocus}>
                {entries.map((entry, index) =>
                    isMenuDivider(entry) ? (
                        <DropdownMenuSeparator key={`divider-${index}`} />
                    ) : (
                        <DropdownMenuItem
                            key={entry.key}
                            disabled={entry.disabled}
                            variant={entry.danger ? "destructive" : "default"}
                            onSelect={() => handleSelect(entry.key)}
                        >
                            {entry.icon ? (
                                <span className="flex shrink-0 items-center">{entry.icon}</span>
                            ) : null}
                            {entry.label}
                        </DropdownMenuItem>
                    ),
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
