import {useEffect, useMemo, useRef, useState} from "react"

import {Search} from "lucide-react"

import {cn} from "../components/ui/utils"

import {FilterMenuRow, selectedValues, summaryLabel} from "./FilterMenuRow"
import type {FilterMenuPlacementProps, FilterMenuSection} from "./types"

/** The Esc hint in the footer — a caption, not a control, so it is a bare `<kbd>`. */
const EscHint = () => (
    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        close
        <kbd className="box-border rounded-control-sm border border-solid border-border bg-muted px-1 py-px font-[inherit] text-[10px] leading-[1.4] text-muted-foreground">
            Esc
        </kbd>
    </span>
)

/**
 * The panel's body: the search field, the two row blocks, and the footer.
 *
 * Split out from the trigger so {@link FilterMenu} owns only the popover around it, and so the
 * rows can be exercised in isolation. Roving focus lives here rather than on the rows: the arrow
 * keys move between rows, which is a fact about the list, not about any one row.
 */
export const FilterMenuPanel = ({
    sections,
    searchable = true,
    searchPlaceholder = "Search filters, sort, group…",
    defaultSearch = "",
    onReset,
    resetLabel = "Reset to defaults",
    flyoutSide,
    flyoutAlign,
    flyoutSideOffset,
    className,
}: {
    sections: FilterMenuSection[]
    searchable?: boolean
    searchPlaceholder?: string
    /** Seeds the search field — a story or a restored view can land on a narrowed panel. */
    defaultSearch?: string
    onReset?: () => void
    resetLabel?: string
    className?: string
} & Pick<FilterMenuPlacementProps, "flyoutSide" | "flyoutAlign" | "flyoutSideOffset">) => {
    const [query, setQuery] = useState(defaultSearch)
    const [openKey, setOpenKey] = useState<string | null>(null)
    const rowRefs = useRef(new Map<string, HTMLButtonElement | null>())
    const searchRef = useRef<HTMLInputElement | null>(null)

    // Search matches a row by its own label OR by any option's — typing "chat" should surface
    // Type, not hide it because the word never appears in the word "Type".
    const matched = useMemo(() => {
        const term = query.trim().toLowerCase()
        return sections.map((section) => {
            if (!term) return {section, options: section.options, visible: true}
            const rowHit = section.label.toLowerCase().includes(term)
            const options = section.options.filter((option) =>
                option.label.toLowerCase().includes(term),
            )
            return {
                section,
                options: rowHit ? section.options : options,
                visible: rowHit || options.length > 0,
            }
        })
    }, [query, sections])

    const visible = matched.filter((entry) => entry.visible)
    const blocks: {key: string; entries: typeof visible}[] = [
        {key: "filter", entries: visible.filter((e) => (e.section.block ?? "filter") === "filter")},
        {key: "sort", entries: visible.filter((e) => e.section.block === "sort")},
    ].filter((block) => block.entries.length > 0)

    const order = visible.map((entry) => entry.section.key)

    const focusRow = (key: string | undefined) => {
        if (!key) return
        rowRefs.current.get(key)?.focus()
    }

    // Radix focuses the content wrapper on open, which beats an input's own `autoFocus` — the
    // popover suppresses that (`onOpenAutoFocus`) and the entry point is chosen here instead.
    // A frame late, because on the opening frame the content is still being positioned and a
    // focus call lands on a node the popover then moves out from under.
    useEffect(() => {
        const frame = requestAnimationFrame(() => {
            if (searchable) searchRef.current?.focus()
            else focusRow(order[0])
        })
        return () => cancelAnimationFrame(frame)
        // Open-time only: re-running would pull focus out of whatever the reader moved to.
    }, [])

    const onRowKeyDown = (key: string) => (event: React.KeyboardEvent<HTMLButtonElement>) => {
        const index = order.indexOf(key)
        if (event.key === "ArrowDown") {
            event.preventDefault()
            focusRow(order[(index + 1) % order.length])
        } else if (event.key === "ArrowUp") {
            event.preventDefault()
            focusRow(order[(index - 1 + order.length) % order.length])
        } else if (event.key === "ArrowRight" || event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            setOpenKey(key)
        }
    }

    return (
        <div className={cn("flex w-[248px] flex-col", className)}>
            {searchable ? (
                <label className="flex items-center gap-2 border-0 border-b border-solid border-border px-3 py-2">
                    <Search size={14} className="shrink-0 text-muted-foreground" aria-hidden />
                    <input
                        ref={searchRef}
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={searchPlaceholder}
                        aria-label={searchPlaceholder}
                        onKeyDown={(event) => {
                            if (event.key !== "ArrowDown") return
                            event.preventDefault()
                            focusRow(order[0])
                        }}
                        className={cn(
                            "box-border w-full appearance-none border-0 bg-transparent p-0 font-[inherit]",
                            "text-[13px] text-foreground outline-none placeholder:text-placeholder",
                        )}
                    />
                </label>
            ) : null}

            {order.length === 0 ? (
                <p className="m-0 px-3 py-8 text-center text-[12px] text-muted-foreground">
                    Nothing matches “{query.trim()}”.
                </p>
            ) : (
                blocks.map((block, blockIndex) => (
                    <div
                        key={block.key}
                        className={cn(
                            "flex flex-col gap-px p-1",
                            blockIndex > 0 && "border-0 border-t border-solid border-border",
                        )}
                    >
                        {block.entries.map((entry) => (
                            <FilterMenuRow
                                key={entry.section.key}
                                section={entry.section}
                                options={entry.options}
                                open={openKey === entry.section.key}
                                onOpenChange={(next) =>
                                    setOpenKey((current) => {
                                        if (next) return entry.section.key
                                        // The row being closed is not always the row that just
                                        // opened: moving the pointer to a new row opens that one
                                        // and only then does the old flyout report itself shut.
                                        // Honouring that late close would wipe the new key.
                                        return current === entry.section.key ? null : current
                                    })
                                }
                                flyoutSide={flyoutSide}
                                flyoutAlign={flyoutAlign}
                                flyoutSideOffset={flyoutSideOffset}
                                tabIndex={0}
                                rowRef={(node) => rowRefs.current.set(entry.section.key, node)}
                                onKeyDown={onRowKeyDown(entry.section.key)}
                            />
                        ))}
                    </div>
                ))
            )}

            <div
                className={cn(
                    "flex items-center gap-2 border-0 border-t border-solid border-border px-3 py-2",
                    onReset ? "justify-between" : "justify-end",
                )}
            >
                {onReset ? (
                    <button
                        type="button"
                        onClick={onReset}
                        className={cn(
                            "box-border cursor-pointer appearance-none border-0 bg-transparent p-0 font-[inherit]",
                            "rounded-control-sm text-[12px] text-muted-foreground outline-none transition-colors",
                            "hover:text-foreground focus-visible:text-foreground focus-visible:underline",
                        )}
                    >
                        {resetLabel}
                    </button>
                ) : null}
                <EscHint />
            </div>
        </div>
    )
}

export {selectedValues, summaryLabel}
