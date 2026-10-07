import {useEffect, useRef, type ReactNode} from "react"

import {useToolCatalogCategories} from "@agenta/entities/gatewayTool"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    cn,
} from "@agenta/ui/ui"
import {useScrollFadeEdges} from "@agenta/ui/hooks"
import {CaretDown} from "@phosphor-icons/react"

import {categoryLabel} from "./categoryLabel"

/** Chips shown before "More"; the catalog lists its busiest categories first. */
const VISIBLE = 6

const CHIP =
    "inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-sm border-0 px-2.5 font-[inherit] text-btn-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"

const chipClass = (on: boolean) =>
    cn(
        CHIP,
        on
            ? // The ring is the fill's own color, so a selected chip rings in the page color.
              "bg-foreground text-background focus-visible:ring-background"
            : "bg-accent/60 text-muted-foreground hover:bg-accent hover:text-foreground",
    )

const Chip = ({on, onClick, children}: {on: boolean; onClick: () => void; children: ReactNode}) => (
    <button type="button" aria-pressed={on} onClick={onClick} className={chipClass(on)}>
        {children}
    </button>
)

/** All, then one chip per category; `null` is All. Renders nothing when categories fail. */
export const CategoryChips = ({
    selected,
    onSelect,
}: {
    selected: string | null
    onSelect: (category: string | null) => void
}) => {
    const {categories, error} = useToolCatalogCategories()
    const rowRef = useRef<HTMLDivElement>(null)
    useScrollFadeEdges(rowRef, {axis: "x", enabled: categories.length > 0})
    // On a phone the row scrolls sideways; keep the selected chip in view.
    useEffect(() => {
        rowRef.current
            ?.querySelector("[aria-pressed=true]")
            ?.scrollIntoView({block: "nearest", inline: "nearest"})
    }, [selected])
    if (error || categories.length === 0) return null

    const shown = categories.slice(0, VISIBLE)
    const rest = categories.slice(VISIBLE)
    // A category picked from More takes a chip, so the selection always shows.
    const picked = rest.find((category) => category.id === selected)
    const more = rest.filter((category) => category.id !== selected)

    return (
        <div
            ref={rowRef}
            role="toolbar"
            aria-label="Categories"
            // Flush with the content edge; the row clips, so chips draw their focus ring inside.
            className="ag-scroll-fade-x flex gap-1.5 overflow-x-auto pt-2 [scrollbar-width:none]"
        >
            <Chip on={selected === null} onClick={() => onSelect(null)}>
                All
            </Chip>
            {[...shown, ...(picked ? [picked] : [])].map((category) => (
                <Chip
                    key={category.id}
                    on={category.id === selected}
                    onClick={() => onSelect(category.id)}
                >
                    {categoryLabel(category.name)}
                </Chip>
            ))}
            {more.length ? (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button type="button" className={chipClass(false)}>
                            More
                            <CaretDown size={12} />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
                        {more.map((category) => (
                            <DropdownMenuItem
                                key={category.id}
                                onSelect={() => onSelect(category.id)}
                            >
                                {categoryLabel(category.name)}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            ) : null}
        </div>
    )
}
