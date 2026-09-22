import {memo, useEffect, type ReactNode} from "react"

import {
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from "@agenta/ui/ui"

/** One row: a place to go (`href`) or a thing to do (`onSelect`). */
export interface CommandPaletteEntry {
    key: string
    label: string
    icon?: ReactNode
    /** Right-aligned context: the agent a session belongs to, a keyboard shortcut. */
    hint?: ReactNode
    href?: string
    onSelect?: () => void
}

export interface CommandPaletteGroup {
    key: string
    heading: string
    entries: CommandPaletteEntry[]
}

export interface CommandPaletteProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    query: string
    onQueryChange: (query: string) => void
    /** Already matched against `query` by the host — the palette lists what it is given. */
    groups: CommandPaletteGroup[]
    /** Follows an entry's `href`; the host owns its router. */
    onNavigate: (href: string) => void
    /** A result set is still on its way, so an empty list is not "nothing matches" yet. */
    loading?: boolean
    placeholder?: string
    /** ⌘K / Ctrl+K toggles it while mounted. */
    shortcut?: boolean
}

/**
 * The "search everything" palette over the shadcn Command. The host builds the groups (sessions,
 * agents, pages, …) and the matching — some sources are searched server-side, and cmdk's own
 * filter would re-filter those hits, so it is off. Picking a row closes the palette.
 */
const CommandPalette = ({
    open,
    onOpenChange,
    query,
    onQueryChange,
    groups,
    onNavigate,
    loading = false,
    placeholder = "Search sessions, agents, pages…",
    shortcut = false,
}: CommandPaletteProps) => {
    useEffect(() => {
        if (!shortcut) return
        const onKey = (event: KeyboardEvent) => {
            if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return
            event.preventDefault()
            onOpenChange(!open)
        }
        document.addEventListener("keydown", onKey)
        return () => document.removeEventListener("keydown", onKey)
    }, [shortcut, open, onOpenChange])

    const shown = groups.filter((group) => group.entries.length > 0)

    const pick = (entry: CommandPaletteEntry) => {
        onOpenChange(false)
        entry.onSelect?.()
        if (entry.href) onNavigate(entry.href)
    }

    return (
        <CommandDialog
            open={open}
            onOpenChange={onOpenChange}
            title="Search"
            description="Search sessions, agents and pages, or run an action."
            shouldFilter={false}
            // Centred (the dialog's own positioning), full width on a phone.
            className="w-[calc(100%-32px)] max-w-[480px]"
        >
            <CommandInput
                value={query}
                onValueChange={onQueryChange}
                placeholder={placeholder}
                autoFocus
            />
            <CommandList>
                {shown.length === 0 ? (
                    <CommandEmpty>{loading ? "Searching…" : "Nothing matches"}</CommandEmpty>
                ) : null}
                {shown.map((group, index) => (
                    <div key={group.key}>
                        {index > 0 ? <CommandSeparator /> : null}
                        <CommandGroup heading={group.heading}>
                            {group.entries.map((entry) => (
                                <CommandItem
                                    key={entry.key}
                                    // Keys, not labels: two sessions can share a name.
                                    value={`${group.key}:${entry.key}`}
                                    onSelect={() => pick(entry)}
                                >
                                    {entry.icon ? (
                                        <span className="flex shrink-0 items-center">
                                            {entry.icon}
                                        </span>
                                    ) : null}
                                    <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                                    {entry.hint ? (
                                        // Capped, or on a phone the agent name ate the session's title.
                                        <span className="ml-auto max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">
                                            {entry.hint}
                                        </span>
                                    ) : null}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </div>
                ))}
            </CommandList>
        </CommandDialog>
    )
}

export default memo(CommandPalette)
