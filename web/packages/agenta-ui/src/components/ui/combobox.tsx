import * as React from "react"

import {X} from "@phosphor-icons/react"
import {ChevronDown, LoaderCircle} from "lucide-react"

import {Popover, PopoverAnchor, PopoverContent} from "./popover"
import {selectTriggerVariants, type SelectTriggerProps} from "./select"
import {cn} from "./utils"

/**
 * Combobox — searchable single-select, the replacement for antd `<Select showSearch />`.
 * Deliberately a SEPARATE component from Select: Radix Select can't search, and adding a
 * `showSearch` prop to it would recreate the antd-shaped-API mistake this migration undoes.
 *
 * Matches antd's showSearch INTERACTION, not the shadcn command-palette one: you type in
 * the TRIGGER itself and the popover shows only the (filtered) options — there is no search
 * box inside the dropdown. The trigger reuses `selectTriggerVariants`, so it is
 * dimensionally identical to Select and inherits its antd parity.
 *
 * A11Y NOTE: this is the one control NOT backed by a Radix primitive (Radix has no searchable
 * select, and the stock shadcn Combobox uses cmdk with a search box IN the dropdown — wrong for
 * antd's showSearch). So the WAI-ARIA "combobox + listbox popup with aria-activedescendant"
 * pattern is implemented BY HAND here: a `role=combobox` input owns `aria-expanded` /
 * `aria-controls` / `aria-activedescendant`; the popup is a `role=listbox` with `role=option`
 * children carrying stable ids + `aria-selected` / `aria-disabled`. Keyboard: Up/Down (skip
 * disabled, wrap), Home/End, Enter, Escape, Backspace-to-clear. Provide `aria-label` /
 * `aria-labelledby` (or wrap with a `<label htmlFor={id}>`) so it has an accessible name.
 *
 * antd → this:
 *   value → value · onChange → onChange · placeholder → placeholder
 *   options[{value,label}] → options (label is any ReactNode; searchValue is the filter text)
 *   optionFilterProp / filterOption / searchLabel → per-option `searchValue`
 *   showSearch → built in · allowClear → allowClear · loading → loading
 *   status="error" → invalid · notFoundContent → emptyText · size → size
 */
export interface ComboboxOption {
    value: string
    /** Display content in the list and (when selected) the trigger. */
    label: React.ReactNode
    /** Text the search filters on. Falls back to the value when omitted. */
    searchValue?: string
    disabled?: boolean
}

/** A titled group of options (antd `<OptGroup>` / grouped `options`). */
export interface ComboboxOptionGroup {
    label: React.ReactNode
    options: ComboboxOption[]
}

function isGroup(o: ComboboxOption | ComboboxOptionGroup): o is ComboboxOptionGroup {
    return "options" in o
}

function flatten(items: (ComboboxOption | ComboboxOptionGroup)[]): ComboboxOption[] {
    return items.flatMap((o) => (isGroup(o) ? o.options : [o]))
}

export interface ComboboxProps extends Pick<SelectTriggerProps, "size" | "variant"> {
    /** Either a flat list or a list of groups. */
    options: (ComboboxOption | ComboboxOptionGroup)[]
    value?: string
    onChange?: (value: string | undefined) => void
    placeholder?: React.ReactNode
    emptyText?: React.ReactNode
    allowClear?: boolean
    disabled?: boolean
    loading?: boolean
    invalid?: boolean
    /** Accessible name for the combobox input (or use `aria-labelledby`). */
    "aria-label"?: string
    "aria-labelledby"?: string
    /** id for the input (so an external `<label htmlFor>` can target it). */
    id?: string
    /** className for the trigger. */
    className?: string
    contentClassName?: string
    /** Start open (for forced-open parity stories / initial-open UX). */
    defaultOpen?: boolean
    /** Portal target for the dropdown; defaults to document.body. */
    container?: HTMLElement | null
}

type RenderRow =
    | {kind: "heading"; key: string; label: React.ReactNode}
    | {kind: "item"; option: ComboboxOption; index: number}

export function Combobox({
    options,
    value,
    onChange,
    placeholder = "Select",
    emptyText = "No results",
    allowClear = false,
    disabled = false,
    loading = false,
    invalid = false,
    size,
    variant,
    className,
    contentClassName,
    defaultOpen = false,
    container,
    id,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledby,
}: ComboboxProps) {
    const [open, setOpen] = React.useState(defaultOpen)
    const [query, setQuery] = React.useState("")
    const [activeIndex, setActiveIndex] = React.useState(0)
    const inputRef = React.useRef<HTMLInputElement>(null)
    const listRef = React.useRef<HTMLDivElement>(null)

    // Stable ids so the input's aria-controls/aria-activedescendant can point at the listbox
    // and the active option (WAI-ARIA combobox). useId is per-instance → no duplicate ids.
    const rid = React.useId()
    const listId = `${rid}-listbox`
    const optionId = (index: number) => `${rid}-opt-${index}`

    const flat = React.useMemo(() => flatten(options), [options])
    const selected = flat.find((o) => o.value === value)

    // Filter groups/options by the trigger query; drop empty groups.
    const {rows, items} = React.useMemo(() => {
        const q = query.trim().toLowerCase()
        const match = (o: ComboboxOption) =>
            !q || (o.searchValue ?? o.value).toLowerCase().includes(q)
        const rows: RenderRow[] = []
        const items: ComboboxOption[] = []
        options.forEach((entry, i) => {
            if (isGroup(entry)) {
                const hits = entry.options.filter(match)
                if (!hits.length) return
                rows.push({kind: "heading", key: `g${i}`, label: entry.label})
                for (const o of hits) {
                    rows.push({kind: "item", option: o, index: items.length})
                    items.push(o)
                }
            } else if (match(entry)) {
                rows.push({kind: "item", option: entry, index: items.length})
                items.push(entry)
            }
        })
        return {rows, items}
    }, [options, query])

    // Next enabled index in a direction, wrapping; returns `from` if none.
    const step = React.useCallback(
        (from: number, dir: 1 | -1) => {
            if (!items.length) return from
            let i = from
            let n = items.length
            while (n-- > 0) {
                i = (i + dir + items.length) % items.length
                if (!items[i]?.disabled) return i
            }
            return from
        },
        [items],
    )
    const firstEnabled = React.useCallback(
        () => (items.findIndex((o) => !o.disabled) + items.length) % Math.max(items.length, 1),
        [items],
    )

    // On open (no query) antd highlights the SELECTED row, not the first — start there (if
    // enabled), else the first enabled. While typing, jump to the first match.
    React.useEffect(() => {
        if (!open) return
        const selIdx = items.findIndex((o) => o.value === value)
        setActiveIndex(!query && selIdx >= 0 && !items[selIdx]?.disabled ? selIdx : firstEnabled())
    }, [open, query, items, value, firstEnabled])
    React.useEffect(() => {
        if (open)
            listRef.current?.querySelector("[data-active=true]")?.scrollIntoView({block: "nearest"})
    }, [activeIndex, open])

    const openMenu = () => {
        if (disabled || loading) return
        setOpen(true)
        inputRef.current?.focus()
    }
    const closeMenu = () => {
        setOpen(false)
        setQuery("")
    }
    const commit = (option: ComboboxOption) => {
        if (option.disabled) return
        onChange?.(option.value)
        closeMenu()
    }

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "ArrowDown") {
            e.preventDefault()
            if (!open) return openMenu()
            setActiveIndex((i) => step(i, 1))
        } else if (e.key === "ArrowUp") {
            e.preventDefault()
            if (!open) return openMenu()
            setActiveIndex((i) => step(i, -1))
        } else if (e.key === "Home" && open) {
            e.preventDefault()
            setActiveIndex(firstEnabled())
        } else if (e.key === "End" && open) {
            e.preventDefault()
            setActiveIndex(step(0, -1))
        } else if (e.key === "Enter") {
            e.preventDefault()
            const o = items[activeIndex]
            if (o) commit(o)
        } else if (e.key === "Escape") {
            e.preventDefault()
            closeMenu()
        } else if (e.key === "Backspace" && !query && selected && allowClear) {
            onChange?.(undefined)
        }
    }

    // antd reddens only the border and the VALUE on error; the placeholder, arrow and clear keep
    // their own colours (select/style/index.js L128, select-input.js L156).
    const adornmentColor = "text-placeholder"
    const showClear = allowClear && selected != null && !disabled && !loading
    const activeDescendant = open && items[activeIndex] ? optionId(activeIndex) : undefined

    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                if (loading) return
                if (next) openMenu()
                else closeMenu()
            }}
        >
            <PopoverAnchor asChild>
                {/* Div, not button: it hosts the search input. Clicking anywhere focuses it. */}
                <div
                    data-slot="combobox-trigger"
                    data-placeholder={selected ? undefined : ""}
                    aria-invalid={invalid || undefined}
                    aria-busy={loading || undefined}
                    className={cn(
                        selectTriggerVariants({size, variant}),
                        // antd separates content from the suffix by paddingXXS*1.5 = 6px, not the
                        // trigger's default 4px (select/style/select-input.js L139).
                        "group/combobox gap-1.5",
                        // The trigger is a div, so the variant's `disabled:` classes (which only
                        // fire on real form controls) don't apply — set the disabled skin here.
                        disabled &&
                            "pointer-events-none cursor-not-allowed border-disabled-border bg-disabled-bg text-disabled",
                        loading && "pointer-events-none",
                        className,
                    )}
                    onMouseDown={(e) => {
                        // Let the clear/input handle their own clicks; otherwise open + focus.
                        if ((e.target as HTMLElement).closest("[data-combobox-clear]")) return
                        e.preventDefault()
                        openMenu()
                    }}
                >
                    <div className="relative flex min-w-0 flex-1 items-center">
                        {/* Selected label / placeholder overlay — hidden while typing. */}
                        {!query && (
                            <span
                                className={cn(
                                    "pointer-events-none absolute inset-0 flex items-center truncate",
                                    !selected && adornmentColor,
                                )}
                            >
                                {selected ? selected.label : placeholder}
                            </span>
                        )}
                        <input
                            ref={inputRef}
                            id={id}
                            role="combobox"
                            aria-label={ariaLabel}
                            aria-labelledby={ariaLabelledby}
                            aria-expanded={open}
                            aria-controls={listId}
                            aria-autocomplete="list"
                            aria-activedescendant={activeDescendant}
                            value={query}
                            disabled={disabled}
                            onChange={(e) => {
                                setQuery(e.target.value)
                                if (!open) setOpen(true)
                            }}
                            onKeyDown={onKeyDown}
                            onFocus={() => !loading && setOpen(true)}
                            className="w-full min-w-0 border-0 bg-transparent p-0 font-[inherit] text-inherit outline-none"
                        />
                    </div>
                    {loading ? (
                        <LoaderCircle
                            className={cn("size-3 shrink-0 animate-spin", adornmentColor)}
                        />
                    ) : (
                        <span className="relative flex shrink-0 items-center">
                            {/* antd Select's closed arrow is a single down chevron (not an up/down caret). */}
                            <ChevronDown className={cn("size-3", adornmentColor)} />
                            {showClear ? (
                                <button
                                    type="button"
                                    data-combobox-clear
                                    tabIndex={-1}
                                    aria-label="Clear selection"
                                    // antd stacks the clear ON the arrow at `opacity: 0` and only
                                    // reveals it on hover (select/style/index.js L22-27, L67).
                                    className={cn(
                                        "absolute inset-0 flex cursor-pointer items-center justify-center rounded-full border-0 bg-background p-0 opacity-0 transition-opacity hover:text-foreground group-hover/combobox:opacity-100",
                                        adornmentColor,
                                    )}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onChange?.(undefined)
                                        setQuery("")
                                    }}
                                >
                                    <X className="size-3" />
                                </button>
                            ) : null}
                        </span>
                    )}
                </div>
            </PopoverAnchor>
            <PopoverContent
                align="start"
                container={container}
                // The popup is the listbox; name the Radix Popover dialog wrapper so it isn't an
                // unnamed dialog, and stop it stealing focus from the input (activedescendant pattern).
                aria-label={ariaLabel ?? "Suggestions"}
                onOpenAutoFocus={(e) => e.preventDefault()}
                onCloseAutoFocus={(e) => e.preventDefault()}
                className={cn(
                    "w-[var(--radix-popover-trigger-width)] p-1 font-portal",
                    contentClassName,
                )}
            >
                <div
                    id={listId}
                    ref={listRef}
                    role="listbox"
                    aria-label={ariaLabel ?? "Suggestions"}
                    className="max-h-[300px] overflow-y-auto"
                >
                    {items.length === 0 ? (
                        <div className="py-4 text-center text-field-sm text-placeholder">
                            {emptyText}
                        </div>
                    ) : (
                        rows.map((row) =>
                            row.kind === "heading" ? (
                                <div
                                    key={row.key}
                                    role="presentation"
                                    className="px-input-sm py-input-y-sm text-field-sm text-placeholder"
                                >
                                    {row.label}
                                </div>
                            ) : (
                                <div
                                    key={row.option.value}
                                    id={optionId(row.index)}
                                    role="option"
                                    aria-selected={row.option.value === value}
                                    aria-disabled={row.option.disabled || undefined}
                                    data-active={row.index === activeIndex}
                                    data-disabled={row.option.disabled || undefined}
                                    onMouseEnter={() =>
                                        !row.option.disabled && setActiveIndex(row.index)
                                    }
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => commit(row.option)}
                                    className={cn(
                                        // antd option geometry: min-h 28px, 4px×12px padding, selected weight 600.
                                        "flex w-full cursor-pointer select-none items-center justify-between gap-2 box-border min-h-control rounded-control-sm px-3 py-1 text-field-md",
                                        // antd: selected row = controlItemBgActive (always); a
                                        // non-selected active/hovered row = controlItemBgHover.
                                        row.option.value === value
                                            ? "bg-controlItemBgActive font-semibold"
                                            : "data-[active=true]:bg-muted",
                                        row.option.disabled && "pointer-events-none text-disabled",
                                    )}
                                >
                                    {row.option.label}
                                </div>
                            ),
                        )
                    )}
                </div>
            </PopoverContent>
        </Popover>
    )
}
