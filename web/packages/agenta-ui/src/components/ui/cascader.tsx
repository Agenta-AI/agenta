import * as React from "react"

import {X} from "@phosphor-icons/react"
import {ChevronDown, ChevronRight, LoaderCircle} from "lucide-react"

import {Popover, PopoverAnchor, PopoverContent} from "./popover"
import {selectTriggerVariants, type SelectTriggerProps} from "./select"
import {cn} from "./utils"

/**
 * Cascader — multi-column hierarchical single-select, the replacement for antd `<Cascader />`.
 *
 * SCOPE: deliberately a SUBSET of antd's API — only what the app actually uses (`options`,
 * `value`, `onChange`, `loadData`, `loading`, `changeOnSelect`, `expandTrigger`,
 * `displayRender`, `placeholder`, `allowClear`, `showSearch`, `disabled`). No `multiple`,
 * no `checkable`, no custom `fieldNames`, no `showCheckedStrategy`.
 *
 * The trigger reuses `selectTriggerVariants` (shared with Select and Combobox) so it is
 * dimensionally identical to the other controls; the panel is hosted on our `Popover`.
 * Search follows antd's `showSearch` INTERACTION: you type in the TRIGGER and the panel is
 * replaced by a flat list of matching paths — there is no search box inside the dropdown.
 *
 * A11Y: `role=combobox` input owns `aria-expanded`/`aria-controls`/`aria-activedescendant`;
 * each column is a `role=listbox` whose rows are `role=option` with `aria-selected` and,
 * for expandable rows, `aria-expanded`. Keyboard: Up/Down within a column (skips disabled,
 * wraps), Right expands into the child column, Left returns to the parent column, Home/End,
 * Enter selects, Escape closes, Backspace clears (when `allowClear`).
 *
 * antd → this:
 *   options/value/onChange/loadData/loading/changeOnSelect/expandTrigger/displayRender →
 *     same names and semantics
 *   popupMenuColumnStyle={{maxWidth}} → `columnMaxWidth` (+ `columnMinWidth`)
 *   `.ant-select-selection-item` overrides → target `[data-slot=cascader-value]`
 *   size small/middle/large → sm/default/lg (inherited from `selectTriggerVariants`)
 */
export interface CascaderOption {
    value: string
    /** Display content in the column and (when selected) the trigger. */
    label?: React.ReactNode
    children?: CascaderOption[]
    /** Explicit leaf marker. When omitted, an option is a leaf if it has no children and
     * no `loadData` is configured (matches antd). */
    isLeaf?: boolean
    disabled?: boolean
    /** Plain text the search filters on and the default trigger display uses. */
    searchLabel?: string
}

export interface CascaderProps extends Pick<SelectTriggerProps, "size" | "variant"> {
    options: CascaderOption[]
    /** Controlled path of option values, root → selected. */
    value?: string[]
    onChange?: (value: string[], selectedOptions: CascaderOption[]) => void
    /** Lazily load an expanded node's children. Called once per node while unloaded. */
    loadData?: (selectedOptions: CascaderOption[]) => void | Promise<unknown>
    /** Whole-control loading (root options still resolving). */
    loading?: boolean
    /** Commit on every level, not only leaves. */
    changeOnSelect?: boolean
    expandTrigger?: "click" | "hover"
    /** Custom rendering of the selected value in the trigger. */
    displayRender?: (labels: string[], selectedOptions?: CascaderOption[]) => React.ReactNode
    placeholder?: React.ReactNode
    emptyText?: React.ReactNode
    allowClear?: boolean
    showSearch?: boolean
    disabled?: boolean
    invalid?: boolean
    /** Per-column max width — replaces antd's `popupMenuColumnStyle={{maxWidth}}`. */
    columnMaxWidth?: number | string
    /** Per-column min width. @default 160 */
    columnMinWidth?: number | string
    /** Max height of a column before it scrolls. @default 300 */
    columnMaxHeight?: number | string
    className?: string
    style?: React.CSSProperties
    contentClassName?: string
    /** Start open (forced-open parity stories / initial-open UX). */
    defaultOpen?: boolean
    /** Portal target for the panel; defaults to document.body. */
    container?: HTMLElement | null
    id?: string
    "aria-label"?: string
    "aria-labelledby"?: string
}

/**
 * Collision-proof, printable path key. JSON-encoding the value array cannot be forged by an
 * option value that happens to contain the separator, and — unlike a raw NUL — keeps the
 * source file plain text so `grep`/`file` can still read it.
 */
const keyOfValues = (values: string[]) => JSON.stringify(values)

const keyOf = (path: CascaderOption[]) => keyOfValues(path.map((o) => o.value))

/** Plain text for search + the default trigger display. */
function optionText(option: CascaderOption): string {
    if (option.searchLabel != null) return option.searchLabel
    if (typeof option.label === "string") return option.label
    if (typeof option.label === "number") return String(option.label)
    return option.value
}

/** Walk `value` through the tree. Unresolved segments become `{value, label: value}` (antd). */
function resolveValuePath(options: CascaderOption[], value?: string[]): CascaderOption[] {
    if (!value?.length) return []
    const out: CascaderOption[] = []
    let level: CascaderOption[] | undefined = options
    for (const v of value) {
        const found: CascaderOption | undefined = level?.find((o) => o.value === v)
        if (found) {
            out.push(found)
            level = found.children
        } else {
            out.push({value: v, label: v})
            level = undefined
        }
    }
    return out
}

interface SearchHit {
    path: CascaderOption[]
    text: string
}

export function Cascader({
    options,
    value,
    onChange,
    loadData,
    loading = false,
    changeOnSelect = false,
    expandTrigger = "click",
    displayRender,
    placeholder = "Select",
    emptyText = "No data",
    allowClear = false,
    showSearch = false,
    disabled = false,
    invalid = false,
    columnMaxWidth,
    columnMinWidth = 160,
    columnMaxHeight = 300,
    size,
    variant,
    className,
    style,
    contentClassName,
    defaultOpen = false,
    container,
    id,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledby,
}: CascaderProps) {
    const [open, setOpen] = React.useState(defaultOpen)
    const [query, setQuery] = React.useState("")
    const [activePath, setActivePath] = React.useState<string[]>(value ?? [])
    const [focus, setFocus] = React.useState({col: 0, index: 0})
    const [pending, setPending] = React.useState<ReadonlySet<string>>(() => new Set<string>())
    // Nodes loadData has already been asked for. Cleared on close/commit so a node whose
    // children were dropped by the consumer can be re-requested (antd re-expands the same way).
    const attemptedRef = React.useRef<Set<string>>(new Set())
    const pendingRef = React.useRef<Set<string>>(new Set())
    const inputRef = React.useRef<HTMLInputElement>(null)
    const panelRef = React.useRef<HTMLDivElement>(null)

    React.useEffect(() => {
        if (open)
            panelRef.current
                ?.querySelector("[data-active=true]")
                ?.scrollIntoView({block: "nearest"})
    }, [open, focus])

    const rid = React.useId()
    const listId = `${rid}-panel`
    const optionId = (col: number, index: number) => `${rid}-opt-${col}-${index}`

    const isLeaf = React.useCallback(
        (option: CascaderOption) => option.isLeaf ?? (!option.children?.length && !loadData),
        [loadData],
    )

    // One entry per rendered column: its items plus the option chain that opened it.
    const columns = React.useMemo(() => {
        const cols: {items: CascaderOption[]; prefix: CascaderOption[]}[] = [
            {items: options, prefix: []},
        ]
        const chain: CascaderOption[] = []
        let level: CascaderOption[] = options
        for (const v of activePath) {
            const option = level.find((o) => o.value === v)
            if (!option) break
            chain.push(option)
            if (isLeaf(option)) break
            const kids = option.children ?? []
            cols.push({items: kids, prefix: [...chain]})
            if (!kids.length) break
            level = kids
        }
        return cols
    }, [options, activePath, isLeaf])

    const selectedOptions = React.useMemo(() => resolveValuePath(options, value), [options, value])
    const selectedValues = value ?? []

    // Search replaces the panel with a flat list of matching paths (antd showSearch).
    // Only loaded options are searchable — same as antd, which cannot see unloaded children.
    const searchHits = React.useMemo<SearchHit[]>(() => {
        const q = query.trim().toLowerCase()
        if (!q) return []
        const hits: SearchHit[] = []
        const walk = (items: CascaderOption[], prefix: CascaderOption[]) => {
            for (const option of items) {
                const path = [...prefix, option]
                const selectable = isLeaf(option) || changeOnSelect
                if (selectable && path.some((p) => optionText(p).toLowerCase().includes(q))) {
                    hits.push({path, text: path.map(optionText).join(" / ")})
                }
                if (option.children?.length) walk(option.children, path)
            }
        }
        walk(options, [])
        return hits
    }, [query, options, changeOnSelect, isLeaf])

    const searching = query.trim().length > 0

    const maybeLoad = React.useCallback(
        (path: CascaderOption[]) => {
            const target = path[path.length - 1]
            if (!loadData || !target || isLeaf(target) || target.children?.length) return
            const key = keyOf(path)
            // Two guards: `attempted` covers the whole open session, `pending` survives a
            // commit that resets `attempted` while a request is still in flight.
            if (attemptedRef.current.has(key) || pendingRef.current.has(key)) return
            attemptedRef.current.add(key)
            pendingRef.current.add(key)
            setPending(new Set(pendingRef.current))
            Promise.resolve(loadData(path))
                .catch(() => undefined)
                .finally(() => {
                    pendingRef.current.delete(key)
                    setPending(new Set(pendingRef.current))
                })
        },
        [loadData, isLeaf],
    )

    const expand = React.useCallback(
        (prefix: CascaderOption[], option: CascaderOption) => {
            const path = [...prefix, option]
            setActivePath(path.map((o) => o.value))
            if (!isLeaf(option)) maybeLoad(path)
        },
        [isLeaf, maybeLoad],
    )

    const closeMenu = React.useCallback(() => {
        setOpen(false)
        setQuery("")
        attemptedRef.current.clear()
    }, [])

    const openMenu = React.useCallback(() => {
        if (disabled || loading) return
        setOpen(true)
        setActivePath(value ?? [])
        setFocus({col: Math.max((value?.length ?? 1) - 1, 0), index: 0})
        inputRef.current?.focus()
    }, [disabled, loading, value])

    const commit = React.useCallback(
        (path: CascaderOption[]) => {
            const last = path[path.length - 1]
            if (!last || last.disabled) return
            attemptedRef.current.clear()
            onChange?.(
                path.map((o) => o.value),
                path,
            )
            // antd: a leaf closes the panel; changeOnSelect on a branch keeps it open so the
            // user can keep drilling.
            if (isLeaf(last)) closeMenu()
        },
        [onChange, isLeaf, closeMenu],
    )

    /** Click semantics: expand branches, commit leaves, commit branches too under changeOnSelect. */
    const activate = React.useCallback(
        (prefix: CascaderOption[], option: CascaderOption) => {
            if (option.disabled) return
            const path = [...prefix, option]
            if (isLeaf(option)) {
                commit(path)
                return
            }
            expand(prefix, option)
            if (changeOnSelect) commit(path)
        },
        [isLeaf, commit, expand, changeOnSelect],
    )

    // Next enabled index in a column, wrapping.
    const step = React.useCallback((items: CascaderOption[], from: number, dir: 1 | -1) => {
        if (!items.length) return from
        let i = from
        let n = items.length
        while (n-- > 0) {
            i = (i + dir + items.length) % items.length
            if (!items[i]?.disabled) return i
        }
        return from
    }, [])

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Escape") {
            e.preventDefault()
            closeMenu()
            return
        }
        if (!open) {
            if (e.key === "ArrowDown" || e.key === "Enter") {
                e.preventDefault()
                openMenu()
            } else if (e.key === "Backspace" && !query && allowClear && selectedValues.length) {
                onChange?.([], [])
            }
            return
        }

        if (searching) {
            const max = searchHits.length
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault()
                if (!max) return
                const dir = e.key === "ArrowDown" ? 1 : -1
                setFocus((f) => ({col: 0, index: (f.index + dir + max) % max}))
            } else if (e.key === "Enter") {
                e.preventDefault()
                const hit = searchHits[focus.index]
                if (hit) commit(hit.path)
            }
            return
        }

        // Clamp: `value` can be deeper than the columns we can render (children not loaded).
        const col = Math.min(focus.col, columns.length - 1)
        const column = columns[col]
        if (!column) return
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault()
            setFocus((f) => ({
                col,
                index: step(column.items, f.index, e.key === "ArrowDown" ? 1 : -1),
            }))
        } else if (e.key === "Home") {
            e.preventDefault()
            setFocus({col, index: step(column.items, column.items.length - 1, 1)})
        } else if (e.key === "End") {
            e.preventDefault()
            setFocus({col, index: step(column.items, 0, -1)})
        } else if (e.key === "ArrowRight") {
            const option = column.items[focus.index]
            if (!option || isLeaf(option) || option.disabled) return
            e.preventDefault()
            expand(column.prefix, option)
            setFocus({col: col + 1, index: 0})
        } else if (e.key === "ArrowLeft") {
            if (col === 0) return
            e.preventDefault()
            setActivePath((p) => p.slice(0, col))
            setFocus({col: col - 1, index: 0})
        } else if (e.key === "Enter") {
            e.preventDefault()
            const option = column.items[focus.index]
            if (option) activate(column.prefix, option)
        }
    }

    // antd greys only the placeholder/arrow, and turns the whole control red on error.
    const adornmentColor = invalid ? "text-error" : "text-placeholder"
    const showClear = allowClear && selectedValues.length > 0 && !disabled && !loading
    const hasValue = selectedValues.length > 0

    const display = React.useMemo(() => {
        if (!hasValue) return null
        // antd hands `labels` the raw option labels (which may be nodes) — mirror that so
        // call-site displayRenders that sniff `typeof labels[0] === "string"` behave the same.
        const labels = selectedOptions.map((o) => o.label ?? o.value) as unknown as string[]
        if (displayRender) return displayRender(labels, selectedOptions)
        return selectedOptions.map(optionText).join(" / ")
    }, [hasValue, selectedOptions, displayRender])

    const activeDescendant = open
        ? searching
            ? searchHits[focus.index] && optionId(0, focus.index)
            : columns[focus.col]?.items[focus.index] && optionId(focus.col, focus.index)
        : undefined

    const columnStyle: React.CSSProperties = {
        minWidth: columnMinWidth,
        maxWidth: columnMaxWidth,
        maxHeight: columnMaxHeight,
    }

    const rowClass = (opts: {selected: boolean; active: boolean; disabled?: boolean}) =>
        cn(
            // antd option geometry: min-h 28px, 4px×12px padding, selected weight 600.
            "flex w-full cursor-pointer select-none items-center justify-between gap-2 box-border min-h-control rounded-control-sm px-3 py-1 text-field-md",
            // antd: selected row = controlItemBgActive (always); a non-selected active/hovered
            // row = controlItemBgHover.
            opts.selected ? "bg-controlItemBgActive font-semibold" : "",
            !opts.selected && opts.active ? "bg-muted" : "",
            opts.disabled && "pointer-events-none text-disabled",
        )

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
                    data-slot="cascader-trigger"
                    data-placeholder={hasValue ? undefined : ""}
                    aria-invalid={invalid || undefined}
                    aria-busy={loading || undefined}
                    style={style}
                    className={cn(
                        selectTriggerVariants({size, variant}),
                        // `group` drives the clear ✕ hover reveal (antd `.ant-select:hover`).
                        "group",
                        // The trigger is a div, so the variant's `disabled:` classes (which only
                        // fire on real form controls) don't apply — set the disabled skin here.
                        disabled &&
                            "pointer-events-none cursor-not-allowed border-disabled-border bg-disabled-bg text-disabled",
                        loading && "pointer-events-none",
                        className,
                    )}
                    onMouseDown={(e) => {
                        if ((e.target as HTMLElement).closest("[data-cascader-clear]")) return
                        e.preventDefault()
                        if (open) closeMenu()
                        else openMenu()
                    }}
                >
                    <div className="relative flex min-w-0 flex-1 items-center">
                        {!query && (
                            <span
                                data-slot="cascader-value"
                                className={cn(
                                    "pointer-events-none absolute inset-0 flex items-center truncate",
                                    !hasValue && adornmentColor,
                                )}
                            >
                                {hasValue ? display : placeholder}
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
                            aria-activedescendant={activeDescendant || undefined}
                            value={query}
                            readOnly={!showSearch}
                            disabled={disabled}
                            onChange={(e) => {
                                if (!showSearch) return
                                setQuery(e.target.value)
                                setFocus({col: 0, index: 0})
                                if (!open) setOpen(true)
                            }}
                            onKeyDown={onKeyDown}
                            className="w-full min-w-0 cursor-[inherit] border-0 bg-transparent p-0 font-[inherit] text-inherit outline-none"
                        />
                    </div>
                    {loading ? (
                        <LoaderCircle
                            className={cn("size-3 shrink-0 animate-spin", adornmentColor)}
                        />
                    ) : (
                        // antd `.ant-select-clear` is opacity 0 at rest and cross-fades over the
                        // arrow on hover; focus-within keeps it keyboard-reachable.
                        <span className="relative flex shrink-0 items-center">
                            <ChevronDown
                                className={cn(
                                    "size-3 shrink-0 transition-opacity",
                                    showClear && "group-hover:opacity-0",
                                    adornmentColor,
                                )}
                            />
                            {showClear ? (
                                <button
                                    type="button"
                                    data-cascader-clear
                                    tabIndex={-1}
                                    aria-label="Clear selection"
                                    className={cn(
                                        "absolute inset-0 flex cursor-pointer items-center justify-center border-0 bg-transparent p-0 opacity-0 transition-opacity hover:text-foreground",
                                        "group-hover:opacity-100 group-focus-within:opacity-100",
                                        adornmentColor,
                                    )}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onChange?.([], [])
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
                aria-label={ariaLabel ?? "Options"}
                onOpenAutoFocus={(e) => e.preventDefault()}
                onCloseAutoFocus={(e) => e.preventDefault()}
                className={cn("p-0 font-portal", contentClassName)}
            >
                <div id={listId} ref={panelRef} className="flex items-stretch">
                    {searching ? (
                        <div
                            role="listbox"
                            aria-label={ariaLabel ?? "Search results"}
                            style={{...columnStyle, maxWidth: undefined}}
                            className="overflow-y-auto p-1"
                        >
                            {searchHits.length === 0 ? (
                                <div className="py-4 text-center text-field-sm text-placeholder">
                                    {emptyText}
                                </div>
                            ) : (
                                searchHits.map((hit, index) => {
                                    const last = hit.path[hit.path.length - 1]
                                    return (
                                        <div
                                            key={keyOf(hit.path)}
                                            id={optionId(0, index)}
                                            role="option"
                                            aria-selected={
                                                keyOf(hit.path) === keyOfValues(selectedValues)
                                            }
                                            aria-disabled={last.disabled || undefined}
                                            data-active={index === focus.index}
                                            onMouseEnter={() => setFocus({col: 0, index})}
                                            onMouseDown={(e) => e.preventDefault()}
                                            onClick={() => commit(hit.path)}
                                            className={rowClass({
                                                selected:
                                                    keyOf(hit.path) === keyOfValues(selectedValues),
                                                active: index === focus.index,
                                                disabled: last.disabled,
                                            })}
                                        >
                                            <span className="truncate">{hit.text}</span>
                                        </div>
                                    )
                                })
                            )}
                        </div>
                    ) : (
                        columns.map((column, col) => {
                            const isPending = pending.has(keyOf(column.prefix))
                            return (
                                <div
                                    key={col === 0 ? "__root__" : keyOf(column.prefix)}
                                    role="listbox"
                                    aria-label={ariaLabel ?? `Level ${col + 1}`}
                                    style={columnStyle}
                                    className={cn(
                                        "overflow-y-auto p-1",
                                        col > 0 && "border-0 border-l border-solid border-border",
                                    )}
                                >
                                    {column.items.length === 0 ? (
                                        <div className="flex items-center justify-center gap-2 py-4 text-field-sm text-placeholder">
                                            {isPending ? (
                                                <LoaderCircle
                                                    className="size-3 animate-spin"
                                                    aria-label="Loading"
                                                />
                                            ) : (
                                                emptyText
                                            )}
                                        </div>
                                    ) : (
                                        column.items.map((option, index) => {
                                            const depth = column.prefix.length
                                            const selected = selectedValues[depth] === option.value
                                            const expanded = activePath[depth] === option.value
                                            const branch = !isLeaf(option)
                                            return (
                                                <div
                                                    key={option.value}
                                                    id={optionId(col, index)}
                                                    role="option"
                                                    aria-selected={selected}
                                                    aria-expanded={branch ? expanded : undefined}
                                                    aria-disabled={option.disabled || undefined}
                                                    data-active={
                                                        focus.col === col && focus.index === index
                                                    }
                                                    onMouseEnter={() => {
                                                        if (option.disabled) return
                                                        setFocus({col, index})
                                                        if (expandTrigger === "hover" && branch)
                                                            expand(column.prefix, option)
                                                    }}
                                                    onMouseDown={(e) => e.preventDefault()}
                                                    onClick={() => activate(column.prefix, option)}
                                                    className={rowClass({
                                                        selected,
                                                        active:
                                                            expanded ||
                                                            (focus.col === col &&
                                                                focus.index === index),
                                                        disabled: option.disabled,
                                                    })}
                                                >
                                                    <span className="min-w-0 truncate">
                                                        {option.label ?? option.value}
                                                    </span>
                                                    {branch ? (
                                                        <ChevronRight className="size-3 shrink-0 text-placeholder" />
                                                    ) : null}
                                                </div>
                                            )
                                        })
                                    )}
                                </div>
                            )
                        })
                    )}
                </div>
            </PopoverContent>
        </Popover>
    )
}
