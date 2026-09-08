import {ChevronRight} from "lucide-react"

import {Popover, PopoverAnchor, PopoverContent} from "../components/ui/popover"
import {cn} from "../components/ui/utils"

import {FilterMenuOptionList} from "./FilterMenuOptionList"
import type {FilterMenuAlign, FilterMenuOption, FilterMenuSection, FilterMenuSide} from "./types"

/** Every checked value on a row, normalised so single- and multi-select read the same. */
export const selectedValues = (section: FilterMenuSection): string[] =>
    Array.isArray(section.value) ? section.value : section.value ? [section.value] : []

/** The muted summary on a row's right: the consumer's `valueLabel`, else the checked labels. */
export const summaryLabel = (section: FilterMenuSection, options: FilterMenuOption[]): string => {
    if (section.valueLabel !== undefined) return section.valueLabel
    const chosen = selectedValues(section)
    const labels = options.filter((option) => chosen.includes(option.value)).map((o) => o.label)
    return labels.length ? labels.join(", ") : "—"
}

/**
 * One row of the panel: icon, label, current value, chevron — and the flyout it opens.
 *
 * The flyout is a nested Popover rather than a Radix submenu because the panel above carries a
 * search field, and a menu's built-in typeahead competes with it for every keystroke.
 *
 * It opens on HOVER, which is why the row is a `PopoverAnchor` and not a `PopoverTrigger`: a
 * trigger toggles on click, so a click on a row the pointer had already opened would shut it
 * again. Pointing at a row is the whole gesture; clicking one does the same thing rather than
 * undoing it.
 */
export const FilterMenuRow = ({
    section,
    options,
    open,
    onOpenChange,
    autoFocusOptions = false,
    onHoverOpen,
    onHoverLeave,
    flyoutSide = "right",
    flyoutAlign = "start",
    flyoutSideOffset = 6,
    rowRef,
    tabIndex,
    onRowFocus,
    onKeyDown,
}: {
    section: FilterMenuSection
    /** The options to show — already narrowed by the panel's search. */
    options: FilterMenuOption[]
    open: boolean
    onOpenChange: (open: boolean) => void
    /**
     * Whether the flyout takes focus when it opens. False under the pointer: the panel's search
     * field is focused, and a flyout that opens because the pointer passed over a row must not
     * take the caret out of what the reader is typing.
     */
    autoFocusOptions?: boolean
    /** Pointer arrived on the row or in its flyout. */
    onHoverOpen?: () => void
    /** Pointer left the row or its flyout — the panel decides how long to wait. */
    onHoverLeave?: () => void
    flyoutSide?: FilterMenuSide
    flyoutAlign?: FilterMenuAlign
    flyoutSideOffset?: number
    rowRef?: (node: HTMLButtonElement | null) => void
    tabIndex?: number
    onRowFocus?: () => void
    onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void
}) => {
    const selected = selectedValues(section)

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            {/* Hovering another row opens that one, which closes this: the panel holds a single
                open key, so the flyout follows the pointer without either row knowing about the
                other. A click does the same as a hover rather than undoing it. */}
            <PopoverAnchor asChild>
                <button
                    ref={rowRef}
                    type="button"
                    aria-haspopup="listbox"
                    aria-expanded={open}
                    tabIndex={tabIndex}
                    onFocus={onRowFocus}
                    onKeyDown={onKeyDown}
                    onMouseEnter={onHoverOpen}
                    onMouseLeave={onHoverLeave}
                    onClick={() => onOpenChange(true)}
                    className={cn(
                        // Preflight is off app-wide, so the <button> reset is restated here.
                        "box-border cursor-pointer appearance-none border-0 bg-transparent font-[inherit]",
                        "flex w-full items-center gap-2 rounded-control-sm px-2 py-1.5 text-left",
                        "text-[13px] text-foreground outline-none transition-colors",
                        "hover:bg-accent focus-visible:bg-accent data-[state=open]:bg-accent",
                    )}
                >
                    {section.icon ? (
                        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                            {section.icon}
                        </span>
                    ) : null}
                    {/* The label never shrinks and the value never grows the panel: the value
                        truncates in place, so a longer selection cannot shift the row. */}
                    <span className="shrink-0">{section.label}</span>
                    <span className="min-w-0 flex-1 truncate text-right text-muted-foreground">
                        {summaryLabel(section, section.options)}
                    </span>
                    <ChevronRight
                        size={14}
                        className="shrink-0 text-muted-foreground"
                        aria-hidden
                    />
                </button>
            </PopoverAnchor>
            <PopoverContent
                side={flyoutSide}
                align={flyoutAlign}
                sideOffset={flyoutSideOffset}
                aria-label={section.label}
                className="flex max-h-[280px] w-[188px] flex-col overflow-y-auto p-1"
                onOpenAutoFocus={(event) => event.preventDefault()}
                // Radix hands focus back to its anchor on close; under the pointer that would
                // pull the caret out of the search field the reader is still typing in.
                onCloseAutoFocus={(event) => event.preventDefault()}
                onMouseEnter={onHoverOpen}
                onMouseLeave={onHoverLeave}
            >
                <FilterMenuOptionList
                    options={options}
                    selected={selected}
                    autoFocus={autoFocusOptions}
                    emptyText={section.emptyText ?? `No ${section.label.toLowerCase()} options`}
                    onDismiss={() => onOpenChange(false)}
                    onSelect={(value) => {
                        section.onChange(value)
                        // A multi row stays open so a reader can tick several; a single row is
                        // done the moment it is answered.
                        if (!section.multi) onOpenChange(false)
                    }}
                />
            </PopoverContent>
        </Popover>
    )
}
