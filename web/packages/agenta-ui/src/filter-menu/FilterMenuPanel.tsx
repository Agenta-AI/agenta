import {useEffect, useMemo, useRef, useState} from "react"

import {ArrowLeft, RotateCcw as ArrowCounterClockwise, Search} from "lucide-react"

import {cn} from "../components/ui/utils"
import {useMediaQuery} from "../hooks/useMediaQuery"

import {FilterMenuOptionList} from "./FilterMenuOptionList"
import {FilterMenuRow, selectedValues, summaryLabel} from "./FilterMenuRow"
import type {FilterMenuPlacementProps, FilterMenuSection} from "./types"

/**
 * Under this width the panel drills in rather than fanning out. 640 is the point where a 188px
 * flyout beside a 248px panel stops fitting beside the thing it belongs to.
 */
export const DRILLDOWN_QUERY = "(max-width: 639.98px)"

/**
 * Reset reads as one more thing you can pick, not as fine print under the list — it is the same
 * row shape as everything above it, so it is as clickable as the rows it undoes.
 */
export const ResetRow = ({
    label,
    onReset,
    disabled = false,
    onMouseEnter,
}: {
    label: string
    onReset: () => void
    /** Reaching the reset row means the reader has left the rows: the panel shuts any flyout. */
    onMouseEnter?: () => void
    /** Nothing to undo. It stays on the panel rather than vanishing — a control that appears
        only once you have changed something is one you cannot learn is there. */
    disabled?: boolean
}) => (
    <div
        className="flex flex-col gap-px border-0 border-t border-solid border-border p-1"
        onMouseEnter={onMouseEnter}
    >
        <button
            type="button"
            onClick={onReset}
            disabled={disabled}
            className={cn(
                // Preflight is off app-wide, so the <button> reset is restated here.
                "box-border appearance-none border-0 bg-transparent font-[inherit]",
                "flex w-full items-center gap-2 rounded-control-sm px-2 py-1.5 text-left",
                "text-[13px] text-muted-foreground outline-none transition-colors",
                disabled
                    ? "cursor-default opacity-45"
                    : "cursor-pointer hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground",
            )}
        >
            <span className="flex size-4 shrink-0 items-center justify-center">
                <ArrowCounterClockwise size={14} aria-hidden />
            </span>
            <span className="truncate">{label}</span>
        </button>
    </div>
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
    resetDisabled,
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
    resetDisabled?: boolean
    className?: string
} & Pick<FilterMenuPlacementProps, "flyoutSide" | "flyoutAlign" | "flyoutSideOffset">) => {
    const [query, setQuery] = useState(defaultSearch)
    const [openKey, setOpenKey] = useState<string | null>(null)
    // Below this there is no room beside the panel for a flyout, and one opened there covers the
    // list it came from — so a row drills IN and the panel carries a way back.
    const drilldown = useMediaQuery(DRILLDOWN_QUERY)
    const [drillKey, setDrillKey] = useState<string | null>(null)
    // How the open flyout was opened. A keyboard reader wants focus inside it; a pointer reader
    // is often still typing in the search field above, so a hover must not take the caret.
    const [openedByKeyboard, setOpenedByKeyboard] = useState(false)
    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
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
    const drilled = drilldown ? (matched.find((e) => e.section.key === drillKey) ?? null) : null
    const blocks: {key: string; entries: typeof visible}[] = [
        {key: "filter", entries: visible.filter((e) => (e.section.block ?? "filter") === "filter")},
        {key: "sort", entries: visible.filter((e) => e.section.block === "sort")},
    ].filter((block) => block.entries.length > 0)

    const order = visible.map((entry) => entry.section.key)

    const cancelClose = () => {
        if (!closeTimer.current) return
        clearTimeout(closeTimer.current)
        closeTimer.current = null
    }

    /**
     * Leaving a row does not close its flyout at once: the pointer has to cross the gap between
     * the row and the flyout, and closing on that first frame would make the options
     * unreachable. Entering either side cancels the pending close.
     */
    const scheduleClose = () => {
        cancelClose()
        closeTimer.current = setTimeout(() => setOpenKey(null), 140)
    }

    const openByHover = (key: string) => {
        cancelClose()
        setOpenedByKeyboard(false)
        setOpenKey(key)
    }

    /** Anything outside the rows — the search field, the reset row — dismisses the flyout. */
    const closeNow = () => {
        cancelClose()
        setOpenKey(null)
    }

    useEffect(() => cancelClose, [])

    const focusRow = (key: string | undefined) => {
        if (!key) return
        rowRefs.current.get(key)?.focus()
    }

    /** A frame late: the flyout is still unmounting, and a focus call inside that is lost. */
    const restoreFocus = (key: string) => {
        requestAnimationFrame(() => focusRow(key))
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
            cancelClose()
            setOpenedByKeyboard(true)
            setOpenKey(key)
        }
    }

    if (drilled) {
        const {section, options} = drilled
        const back = () => setDrillKey(null)
        return (
            <div
                className={cn("flex w-[248px] flex-col", className)}
                onKeyDown={(event) => {
                    // Escape steps back to the rows before it closes the panel — the reader is
                    // one level in, and losing the whole menu is not what "back" means.
                    if (event.key !== "Escape") return
                    event.preventDefault()
                    event.stopPropagation()
                    back()
                }}
            >
                <div className="flex items-center gap-1 border-0 border-b border-solid border-border p-1">
                    <button
                        type="button"
                        onClick={back}
                        aria-label={`Back to filters`}
                        className={cn(
                            "box-border cursor-pointer appearance-none border-0 bg-transparent font-[inherit]",
                            "flex min-w-0 flex-1 items-center gap-2 rounded-control-sm px-2 py-1.5 text-left",
                            "text-[13px] font-medium text-foreground outline-none transition-colors",
                            "hover:bg-accent focus-visible:bg-accent",
                        )}
                    >
                        <ArrowLeft size={14} aria-hidden className="shrink-0" />
                        <span className="truncate">{section.label}</span>
                    </button>
                </div>
                <div className="flex max-h-[280px] flex-col overflow-y-auto p-1">
                    <FilterMenuOptionList
                        options={options}
                        selected={selectedValues(section)}
                        emptyText={section.emptyText ?? `No ${section.label.toLowerCase()} options`}
                        onDismiss={back}
                        onSelect={(value) => {
                            section.onChange(value)
                            // A single answer is done, so the panel returns to the rows; a multi
                            // row stays put so a reader can tick several.
                            if (!section.multi) back()
                        }}
                    />
                </div>
            </div>
        )
    }

    return (
        <div className={cn("flex w-[248px] flex-col", className)}>
            {searchable ? (
                <label
                    className="flex items-center gap-2 border-0 border-b border-solid border-border px-3 py-2"
                    onMouseEnter={closeNow}
                >
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

            {/* The rows sit off the search field's rule rather than starting against it — the
                gap belongs to the panel, not to whichever block happens to be first. */}
            {searchable ? <div aria-hidden className="h-1.5 shrink-0" /> : null}

            {order.length === 0 ? (
                <p className="m-0 px-3 py-8 text-center text-[12px] text-muted-foreground">
                    Nothing matches “{query.trim()}”.
                </p>
            ) : (
                blocks.map((block) => (
                    <div
                        key={block.key}
                        // No rule between the blocks: the sort and group rows are the same kind
                        // of thing as the filters above them, and a line there read as a break
                        // in a list that has none.
                        className="flex flex-col gap-px p-1 pt-0"
                    >
                        {block.entries.map((entry) => (
                            <FilterMenuRow
                                key={entry.section.key}
                                section={entry.section}
                                options={entry.options}
                                open={openKey === entry.section.key}
                                autoFocusOptions={openedByKeyboard}
                                inline={drilldown}
                                onActivate={() => setDrillKey(entry.section.key)}
                                onHoverOpen={() => openByHover(entry.section.key)}
                                onHoverLeave={scheduleClose}
                                onOpenChange={(next) => {
                                    // A flyout the keyboard opened took focus into itself, and
                                    // `onCloseAutoFocus` is prevented, so closing it would drop
                                    // focus on <body>. The row it came from gets it back.
                                    if (!next && openedByKeyboard && openKey === entry.section.key)
                                        restoreFocus(entry.section.key)
                                    setOpenKey((current) => {
                                        if (next) return entry.section.key
                                        // The row being closed is not always the row that just
                                        // opened: moving the pointer to a new row opens that one
                                        // and only then does the old flyout report itself shut.
                                        // Honouring that late close would wipe the new key.
                                        return current === entry.section.key ? null : current
                                    })
                                }}
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

            {onReset ? (
                <ResetRow
                    label={resetLabel}
                    onReset={onReset}
                    disabled={resetDisabled}
                    onMouseEnter={closeNow}
                />
            ) : null}
        </div>
    )
}

export {selectedValues, summaryLabel}
