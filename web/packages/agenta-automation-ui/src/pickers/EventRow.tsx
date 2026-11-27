import {ArrowRightIcon, CheckIcon} from "@phosphor-icons/react"

import {cn} from "../lib/utils"

/**
 * One pickable event: its name, and a check when it is the bound one.
 *
 * No app mark on the row: every event here belongs to the app the rail has selected, and a
 * column of identical logos read as a column of different things.
 */
export const EventRow = ({
    label,
    selected,
    onSelect,
}: {
    label: string
    selected: boolean
    onSelect: () => void
}) => (
    <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={cn(
            "group flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 py-1.5 text-left text-label text-foreground hover:bg-accent",
            selected && "bg-selected",
        )}
    >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {selected ? (
            <CheckIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
            // Picking opens the event's filters, so the row hints at a step ahead.
            <ArrowRightIcon
                aria-hidden
                className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 pointer-coarse:opacity-100"
            />
        )}
    </button>
)
