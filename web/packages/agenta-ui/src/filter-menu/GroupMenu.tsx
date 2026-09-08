import {useEffect, useMemo, useRef, useState} from "react"

import {Group} from "lucide-react"

import {Popover, PopoverContent} from "../components/ui/popover"

import {FilterMenuOptionList} from "./FilterMenuOptionList"
import {ResetRow} from "./FilterMenuPanel"
import {FilterMenuTrigger} from "./FilterMenuTrigger"
import type {FilterMenuOption, FilterMenuPlacementProps, FilterMenuTriggerProps} from "./types"

export interface GroupMenuProps<Value extends string = string>
    extends
        FilterMenuTriggerProps,
        Pick<FilterMenuPlacementProps, "side" | "align" | "sideOffset"> {
    options: FilterMenuOption<Value>[]
    value: Value | Value[]
    onChange: (value: Value) => void
    /** Options toggle instead of replacing each other. */
    multi?: boolean
    /** A search field over the options. Off by default — a group control is a short list. */
    searchable?: boolean
    searchPlaceholder?: string
    /** Seeds the search field. */
    defaultSearch?: string
    /** What the panel says when `options` is empty. */
    emptyText?: string
    /** Absent hides the reset row entirely — there is nothing else in that footer. */
    onReset?: () => void
    resetLabel?: string
    /** The view is already at its defaults: the row stays, greyed, rather than disappearing. */
    resetDisabled?: boolean
    open?: boolean
    onOpenChange?: (open: boolean) => void
    className?: string
}

/**
 * The smaller sibling: one option list in a popover, for a surface that wants a standalone group
 * control instead of a group row inside {@link FilterMenu}.
 *
 * It is the flyout's own list rather than a second implementation of it, so a check mark, an
 * empty state and the arrow keys behave identically in both places.
 */
export const GroupMenu = <Value extends string = string>({
    options,
    value,
    onChange,
    multi,
    searchable = false,
    searchPlaceholder = "Search",
    defaultSearch = "",
    emptyText = "Nothing to group by",
    onReset,
    resetLabel = "Reset to defaults",
    resetDisabled,
    open: openProp,
    onOpenChange,
    side = "bottom",
    align = "start",
    sideOffset = 6,
    className,
    label,
    icon,
    size,
    variant,
    triggerClassName,
    triggerAriaLabel,
    activeCount,
}: GroupMenuProps<Value>) => {
    const [uncontrolled, setUncontrolled] = useState(false)
    const [query, setQuery] = useState(defaultSearch)
    const open = openProp ?? uncontrolled
    const setOpen = (next: boolean) => {
        setUncontrolled(next)
        onOpenChange?.(next)
    }

    const searchRef = useRef<HTMLInputElement | null>(null)

    // Radix's own open-focus is suppressed below, so the caret lands here rather than on the
    // content wrapper.
    useEffect(() => {
        if (open && searchable) searchRef.current?.focus()
    }, [open, searchable])

    const selected = Array.isArray(value) ? value : value ? [value] : []
    const shown = useMemo(() => {
        const term = query.trim().toLowerCase()
        if (!searchable || !term) return options
        return options.filter((option) => option.label.toLowerCase().includes(term))
    }, [options, query, searchable])

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <FilterMenuTrigger
                label={label}
                icon={icon ?? <Group size={14} aria-hidden />}
                size={size}
                variant={variant}
                triggerClassName={triggerClassName}
                triggerAriaLabel={triggerAriaLabel}
                activeCount={activeCount}
                defaultLabel="Group"
            />
            <PopoverContent
                side={side}
                align={align}
                sideOffset={sideOffset}
                aria-label="Group by"
                className={className ?? "w-[220px] p-0"}
                onOpenAutoFocus={(event) => event.preventDefault()}
            >
                {searchable ? (
                    <label className="flex items-center gap-2 border-0 border-b border-solid border-border px-3 py-2">
                        <input
                            ref={searchRef}
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder={searchPlaceholder}
                            aria-label={searchPlaceholder}
                            className="box-border w-full appearance-none border-0 bg-transparent p-0 font-[inherit] text-[13px] text-foreground outline-none placeholder:text-placeholder"
                        />
                    </label>
                ) : null}
                <FilterMenuOptionList
                    className="p-1"
                    options={shown}
                    selected={selected}
                    emptyText={query.trim() ? `Nothing matches “${query.trim()}”.` : emptyText}
                    autoFocus={!searchable}
                    onSelect={(next) => {
                        onChange(next as Value)
                        if (!multi) setOpen(false)
                    }}
                    onDismiss={() => setOpen(false)}
                />
                {onReset ? (
                    <ResetRow label={resetLabel} onReset={onReset} disabled={resetDisabled} />
                ) : null}
            </PopoverContent>
        </Popover>
    )
}
