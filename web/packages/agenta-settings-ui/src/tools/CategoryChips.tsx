import {useEffect, useRef, type ReactNode} from "react"

import {useToolCatalogCategories} from "@agenta/entities/gatewayTool"
import {useScrollFadeEdges} from "@agenta/ui/hooks"
import {cn} from "@agenta/ui/ui"

import {categoryLabel} from "./categoryLabel"

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

/** All, then every category in one scrolling row; `null` is All. Nothing when categories fail. */
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
    // The row hides its scrollbar, so a mouse wheel scrolls it sideways; at an end, the page scrolls.
    useEffect(() => {
        const row = rowRef.current
        if (!row) return
        const onWheel = (event: WheelEvent) => {
            if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
            const max = row.scrollWidth - row.clientWidth
            const next = Math.min(max, Math.max(0, row.scrollLeft + event.deltaY))
            if (next === row.scrollLeft) return
            event.preventDefault()
            row.scrollLeft = next
        }
        row.addEventListener("wheel", onWheel, {passive: false})
        return () => row.removeEventListener("wheel", onWheel)
    }, [categories.length])
    if (error || categories.length === 0) return null

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
            {categories.map((category) => (
                <Chip
                    key={category.id}
                    on={category.id === selected}
                    onClick={() => onSelect(category.id)}
                >
                    {categoryLabel(category.name)}
                </Chip>
            ))}
        </div>
    )
}
