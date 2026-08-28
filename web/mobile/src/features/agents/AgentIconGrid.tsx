import {useEffect, useMemo, useState} from "react"

import {
    AGENT_ICON_CHIP_CLASS,
    AgentIcon,
    agentIconChipStyle,
    type PhosphorCatalogEntry,
} from "@agenta/ui/agent-icon"
import {SearchInput} from "@agenta/ui/ui"

import {AgentIconGridEmpty} from "./states/AgentIconStates"

import {FOCUS_RING} from "@/lib/interactive"

/**
 * Search over the icon set, then the icons.
 *
 * Not virtualized: the catalog is curated to 160, so the whole grid is ~27 rows of plain SVG and a
 * windowing library would cost more than it saves. The sheet is already the scroller.
 */
export const AgentIconGrid = ({
    entries,
    selectedName,
    color,
    onPick,
}: {
    entries: PhosphorCatalogEntry[]
    /** Empty until the agent has a stored choice, so nothing reads as picked before it is. */
    selectedName: string
    color: string
    onPick: (entry: PhosphorCatalogEntry) => void
}) => {
    const [query, setQuery] = useState("")
    const [search, setSearch] = useState("")

    useEffect(() => {
        const id = setTimeout(() => setSearch(query.trim().toLowerCase()), 150)
        return () => clearTimeout(id)
    }, [query])

    /** One string per icon, built once, so a keystroke is one `includes` per icon. */
    const haystacks = useMemo(
        () =>
            entries.map(
                (entry) =>
                    `${entry.name.replace(/-/g, " ")} ${entry.tags.join(" ")} ${entry.categories.join(" ")}`,
            ),
        [entries],
    )

    const filtered = useMemo(
        () =>
            search ? entries.filter((_entry, index) => haystacks[index].includes(search)) : entries,
        [entries, haystacks, search],
    )

    return (
        <div className="flex flex-col gap-3">
            <SearchInput
                value={query}
                onValueChange={setQuery}
                placeholder="Search icons"
                aria-label="Search icons"
            />
            {filtered.length === 0 ? (
                <AgentIconGridEmpty query={search} />
            ) : (
                <div className="grid h-64 grid-cols-6 gap-1 overflow-y-auto">
                    {filtered.map((entry) => {
                        const selected = entry.name === selectedName
                        return (
                            <button
                                key={entry.name}
                                type="button"
                                aria-label={entry.name.replace(/-/g, " ")}
                                aria-pressed={selected}
                                onClick={() => onPick(entry)}
                                className={`flex size-11 cursor-pointer items-center justify-center rounded-lg border-0 p-0 transition-colors ${FOCUS_RING} ${
                                    selected
                                        ? AGENT_ICON_CHIP_CLASS
                                        : "bg-transparent text-muted-foreground hover:bg-accent active:bg-accent"
                                }`}
                                style={selected ? agentIconChipStyle(color) : undefined}
                            >
                                <AgentIcon path={entry.path} size={20} />
                            </button>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
