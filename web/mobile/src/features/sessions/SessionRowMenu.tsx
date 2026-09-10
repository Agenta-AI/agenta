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
                    // The automations list row's kebab, to the class: same 24px box, same glyph
                    // size, same hover. The two tables share a last column.
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Actions for ${label}`}
                    className="text-muted-foreground hover:bg-foreground/10 dark:hover:bg-foreground/15"
                >
                    {/* `size-3.5` as a CLASS, not a `size` prop: the button's own
                        `[&_svg:not([class*='size-'])]:size-3` wins over the attribute, so the prop
                        silently rendered 12px. Three dots also read smaller than a glyph that
                        fills its box, so 14 is what matches by eye. */}
                    <DotsThreeVertical aria-hidden className="size-3.5" weight="bold" />
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
