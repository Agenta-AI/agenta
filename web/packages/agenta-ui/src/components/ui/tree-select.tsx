import * as React from "react"

import {X} from "@phosphor-icons/react"
import {ChevronDown, ChevronRight, LoaderCircle} from "lucide-react"

import {Popover, PopoverAnchor, PopoverContent} from "./popover"
import {selectTriggerVariants, type SelectTriggerProps} from "./select"
import {cn} from "./utils"

/**
 * TreeSelect — single-select over an inline, arbitrarily nested tree; the replacement for antd
 * `<TreeSelect />`.
 *
 * NOT a Cascader. Cascader is multi-column drill-down and commits a PATH (`string[]`); this
 * shows the whole tree at once, indented, and commits ONE node value (`string`). The
 * observability attribute-key picker needs the latter: every node is selectable, the panel is
 * rendered fully expanded so a key is one click away, and the host injects synthetic nodes from
 * the live search term (`onSearch`) so an attribute key absent from the loaded traces can still
 * be typed and selected.
 *
 * SCOPE: single-select only — no `treeCheckable`, no `multiple`/`tags`, no `loadData`, no custom
 * `fieldNames`. Add them when an actual call site needs them.
 *
 * The trigger reuses `selectTriggerVariants` (shared with Select, Combobox and Cascader) so it is
 * dimensionally identical to the other controls; the panel is hosted on our `Popover`.
 * Search follows antd's `showSearch` INTERACTION: you type in the TRIGGER, and the tree filters
 * in place (matches plus their ancestors, everything force-expanded) — there is no search box
 * inside the dropdown.
 *
 * A11Y: `role=combobox` input owns `aria-expanded`/`aria-controls`/`aria-activedescendant` and
 * declares `aria-haspopup=tree`; the panel is a `role=tree` whose rows are `role=treeitem` with
 * `aria-level`, `aria-selected`, and `aria-expanded` on branches. Keyboard: Up/Down over the
 * visible rows (skips disabled, wraps), Right expands / descends, Left collapses / ascends,
 * Home/End, Enter selects (or toggles a non-selectable branch), Escape closes, Backspace clears
 * (when `allowClear`).
 *
 * antd → this:
 *   treeData/value/onChange/onSearch/placeholder/disabled/loading → same names and semantics
 *   node `title` → `label` · `treeNodeLabelProp` → per-option `displayLabel`
 *   `treeNodeFilterProp`/`filterTreeNode` → per-option `searchLabel` (value is always matched too)
 *   `treeDefaultExpandAll` → `defaultExpandAll` · `treeExpandedKeys`/`onTreeExpand` →
 *     `expandedKeys`/`onExpandedKeysChange`
 *   `treeLine` → `showLine` · `dropdownMatchSelectWidth={false}` + popup minWidth → `panelMinWidth`
 *   `.ant-select-selection-item` overrides → target `[data-slot=tree-select-value]`
 *   size small/middle/large → sm/default/lg (inherited from `selectTriggerVariants`)
 */
export interface TreeSelectOption {
    value: string
    /** Row content. Defaults to `value`. */
    label?: React.ReactNode
    children?: TreeSelectOption[]
    /** A non-selectable node is a pure branch: clicking it toggles expansion. @default true */
    selectable?: boolean
    disabled?: boolean
    /** Plain text the search filters on. Falls back to a string `label`, then `value`. */
    searchLabel?: string
    /** Trigger content once selected (antd `treeNodeLabelProp`). Falls back to `label`. */
    displayLabel?: React.ReactNode
}

export interface TreeSelectProps extends Pick<SelectTriggerProps, "size" | "variant"> {
    treeData: TreeSelectOption[]
    /** Controlled selected node value. */
    value?: string
    onChange?: (value: string | undefined, option?: TreeSelectOption) => void
    /** Fires on every keystroke and on close (with ""), so the host can inject synthetic nodes. */
    onSearch?: (query: string) => void
    onOpenChange?: (open: boolean) => void
    showSearch?: boolean
    /** Expand every branch, and keep newly arriving branches expanded. */
    defaultExpandAll?: boolean
    /** Controlled expansion, by node value. Omit for internal state. */
    expandedKeys?: string[]
    onExpandedKeysChange?: (keys: string[]) => void
    placeholder?: React.ReactNode
    emptyText?: React.ReactNode
    allowClear?: boolean
    disabled?: boolean
    loading?: boolean
    invalid?: boolean
    /** Vertical indent guides (antd `treeLine`). @default true */
    showLine?: boolean
    /** Indent per depth level, px. @default 16 */
    indent?: number
    /** Panel min width. @default the trigger's width */
    panelMinWidth?: number | string
    panelMaxWidth?: number | string
    /** Max height before the panel scrolls. @default 320 */
    panelMaxHeight?: number | string
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

/** Collision-proof, printable row key: the ancestor chain, JSON-encoded. */
const keyOfValues = (values: string[]) => JSON.stringify(values)

/** Plain text for search + the default trigger display. */
function optionText(option: TreeSelectOption): string {
    if (option.searchLabel != null) return option.searchLabel
    if (typeof option.label === "string") return option.label
    if (typeof option.label === "number") return String(option.label)
    return option.value
}

const isSelectable = (option: TreeSelectOption) => option.selectable !== false && !option.disabled

/** Ancestor chain ending at `value`, or undefined when the value is not in the tree. */
function findPath(
    items: TreeSelectOption[],
    value: string | undefined,
): TreeSelectOption[] | undefined {
    if (!value) return undefined
    for (const option of items) {
        if (option.value === value) return [option]
        const nested = option.children?.length ? findPath(option.children, value) : undefined
        if (nested) return [option, ...nested]
    }
    return undefined
}

function collectBranchValues(items: TreeSelectOption[], acc: string[] = []): string[] {
    for (const option of items) {
        if (option.children?.length) {
            acc.push(option.value)
            collectBranchValues(option.children, acc)
        }
    }
    return acc
}

interface FlatRow {
    key: string
    option: TreeSelectOption
    depth: number
    branch: boolean
    expanded: boolean
    /** Index of the row's parent in the flattened list, -1 at the root. */
    parent: number
}

export function TreeSelect({
    treeData,
    value,
    onChange,
    onSearch,
    onOpenChange,
    showSearch = true,
    defaultExpandAll = false,
    expandedKeys,
    onExpandedKeysChange,
    placeholder = "Select",
    emptyText = "No data",
    allowClear = false,
    disabled = false,
    loading = false,
    invalid = false,
    showLine = true,
    indent = 16,
    panelMinWidth,
    panelMaxWidth,
    panelMaxHeight = 320,
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
}: TreeSelectProps) {
    const [open, setOpen] = React.useState(defaultOpen)
    const [query, setQuery] = React.useState("")
    const [focus, setFocus] = React.useState(0)
    const [internalExpanded, setInternalExpanded] = React.useState<ReadonlySet<string>>(
        () => new Set<string>(),
    )
    // Branches already auto-expanded once, so a later treeData change (the host injecting a
    // synthetic node on every keystroke) does not undo a manual collapse.
    const autoExpandedRef = React.useRef<Set<string>>(new Set())
    const inputRef = React.useRef<HTMLInputElement>(null)
    const panelRef = React.useRef<HTMLDivElement>(null)

    const rid = React.useId()
    const treeId = `${rid}-tree`
    const rowId = (index: number) => `${rid}-row-${index}`

    const controlledExpansion = expandedKeys != null
    const expanded = React.useMemo(
        () => (expandedKeys ? new Set(expandedKeys) : internalExpanded),
        [expandedKeys, internalExpanded],
    )

    const applyExpanded = React.useCallback(
        (next: Set<string>) => {
            if (!controlledExpansion) setInternalExpanded(next)
            onExpandedKeysChange?.(Array.from(next))
        },
        [controlledExpansion, onExpandedKeysChange],
    )

    const branchValues = React.useMemo(() => collectBranchValues(treeData), [treeData])

    React.useEffect(() => {
        if (!defaultExpandAll || controlledExpansion) return
        const fresh = branchValues.filter((v) => !autoExpandedRef.current.has(v))
        if (!fresh.length) return
        fresh.forEach((v) => autoExpandedRef.current.add(v))
        setInternalExpanded((prev) => new Set([...prev, ...fresh]))
    }, [defaultExpandAll, controlledExpansion, branchValues])

    const searching = query.trim().length > 0

    // Nodes kept while searching: a match, or an ancestor of one (antd's in-place filter).
    const visible = React.useMemo<ReadonlySet<string> | null>(() => {
        const q = query.trim().toLowerCase()
        if (!q) return null
        const keep = new Set<string>()
        const walk = (items: TreeSelectOption[]): boolean => {
            let any = false
            for (const option of items) {
                const kids = option.children?.length ? walk(option.children) : false
                const self =
                    optionText(option).toLowerCase().includes(q) ||
                    option.value.toLowerCase().includes(q)
                if (kids || self) {
                    keep.add(option.value)
                    any = true
                }
            }
            return any
        }
        walk(treeData)
        return keep
    }, [query, treeData])

    const rows = React.useMemo<FlatRow[]>(() => {
        const out: FlatRow[] = []
        const walk = (
            items: TreeSelectOption[],
            depth: number,
            prefix: string[],
            parent: number,
        ) => {
            for (const option of items) {
                if (visible && !visible.has(option.value)) continue
                const kids = option.children ?? []
                const branch = kids.length > 0
                // A filtered tree is always fully expanded, so every match stays reachable.
                const isExpanded = branch && (searching || expanded.has(option.value))
                const chain = [...prefix, option.value]
                const index = out.length
                out.push({
                    key: keyOfValues(chain),
                    option,
                    depth,
                    branch,
                    expanded: isExpanded,
                    parent,
                })
                if (isExpanded) walk(kids, depth + 1, chain, index)
            }
        }
        walk(treeData, 0, [], -1)
        return out
    }, [treeData, expanded, visible, searching])

    const selectedPath = React.useMemo(() => findPath(treeData, value), [treeData, value])
    const selectedOption = selectedPath?.[selectedPath.length - 1]

    React.useEffect(() => {
        if (open)
            panelRef.current
                ?.querySelector("[data-active=true]")
                ?.scrollIntoView({block: "nearest"})
    }, [open, focus, rows])

    const setSearch = React.useCallback(
        (next: string) => {
            setQuery(next)
            onSearch?.(next)
        },
        [onSearch],
    )

    const closeMenu = React.useCallback(() => {
        setOpen(false)
        setSearch("")
        onOpenChange?.(false)
    }, [setSearch, onOpenChange])

    const openMenu = React.useCallback(() => {
        if (disabled || loading) return
        setOpen(true)
        onOpenChange?.(true)
        // Reveal the selection: expand its ancestors (never the node itself).
        const path = findPath(treeData, value)
        if (path && path.length > 1 && !controlledExpansion) {
            const ancestors = path.slice(0, -1).map((o) => o.value)
            setInternalExpanded((prev) => new Set([...prev, ...ancestors]))
        }
        inputRef.current?.focus()
    }, [disabled, loading, onOpenChange, treeData, value, controlledExpansion])

    const rowsRef = React.useRef(rows)
    rowsRef.current = rows

    // Focus the selected row on open. Deliberately not keyed on `rows` — re-running on every
    // flatten (search, expand) would fight the user's own Up/Down.
    React.useEffect(() => {
        if (!open) return
        const index = rowsRef.current.findIndex((row) => row.option.value === value)
        setFocus(index >= 0 ? index : 0)
    }, [open, value])

    const toggle = React.useCallback(
        (option: TreeSelectOption, next?: boolean) => {
            const set = new Set(expanded)
            const wanted = next ?? !set.has(option.value)
            if (wanted) set.add(option.value)
            else set.delete(option.value)
            applyExpanded(set)
        },
        [expanded, applyExpanded],
    )

    const commit = React.useCallback(
        (option: TreeSelectOption) => {
            if (!isSelectable(option)) return
            onChange?.(option.value, option)
            closeMenu()
        },
        [onChange, closeMenu],
    )

    /** Click semantics: select a selectable node, otherwise toggle the branch. */
    const activate = React.useCallback(
        (row: FlatRow) => {
            if (row.option.disabled) return
            if (isSelectable(row.option)) commit(row.option)
            else if (row.branch) toggle(row.option)
        },
        [commit, toggle],
    )

    // Next enabled row, wrapping.
    const step = React.useCallback((list: FlatRow[], from: number, dir: 1 | -1) => {
        if (!list.length) return from
        let i = from
        let n = list.length
        while (n-- > 0) {
            i = (i + dir + list.length) % list.length
            if (!list[i]?.option.disabled) return i
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
            } else if (e.key === "Backspace" && !query && allowClear && value) {
                onChange?.(undefined, undefined)
            }
            return
        }
        if (!rows.length) return

        const index = Math.min(focus, rows.length - 1)
        const row = rows[index]
        if (!row) return

        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault()
            setFocus(step(rows, index, e.key === "ArrowDown" ? 1 : -1))
        } else if (e.key === "Home") {
            e.preventDefault()
            setFocus(step(rows, rows.length - 1, 1))
        } else if (e.key === "End") {
            e.preventDefault()
            setFocus(step(rows, 0, -1))
        } else if (e.key === "ArrowRight") {
            if (!row.branch || row.option.disabled) return
            e.preventDefault()
            if (!row.expanded) toggle(row.option, true)
            else setFocus(Math.min(index + 1, rows.length - 1))
        } else if (e.key === "ArrowLeft") {
            e.preventDefault()
            if (row.branch && row.expanded) toggle(row.option, false)
            else if (row.parent >= 0) setFocus(row.parent)
        } else if (e.key === "Enter") {
            e.preventDefault()
            activate(row)
        }
    }

    // antd greys only the placeholder/arrow, and turns the whole control red on error.
    const adornmentColor = invalid ? "text-error" : "text-placeholder"
    const hasValue = value != null && value !== ""
    const showClear = allowClear && hasValue && !disabled && !loading

    // antd falls back to the raw value when the node is missing from treeData.
    const display = hasValue
        ? (selectedOption?.displayLabel ?? selectedOption?.label ?? value)
        : null

    const activeDescendant = open && rows[focus] ? rowId(focus) : undefined

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
                    data-slot="tree-select-trigger"
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
                        if ((e.target as HTMLElement).closest("[data-tree-select-clear]")) return
                        e.preventDefault()
                        if (open) closeMenu()
                        else openMenu()
                    }}
                >
                    <div className="relative flex min-w-0 flex-1 items-center">
                        {!query && (
                            <span
                                data-slot="tree-select-value"
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
                            aria-haspopup="tree"
                            // Fall back to the placeholder so the field is never anonymous.
                            aria-label={
                                ariaLabelledby
                                    ? undefined
                                    : (ariaLabel ??
                                      (typeof placeholder === "string" ? placeholder : undefined))
                            }
                            aria-labelledby={ariaLabelledby}
                            aria-expanded={open}
                            aria-controls={treeId}
                            aria-autocomplete="list"
                            aria-activedescendant={activeDescendant}
                            value={query}
                            readOnly={!showSearch}
                            disabled={disabled}
                            onChange={(e) => {
                                if (!showSearch) return
                                setSearch(e.target.value)
                                setFocus(0)
                                if (!open) {
                                    setOpen(true)
                                    onOpenChange?.(true)
                                }
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
                                    data-tree-select-clear
                                    tabIndex={-1}
                                    aria-label="Clear selection"
                                    className={cn(
                                        "absolute inset-0 flex cursor-pointer items-center justify-center border-0 bg-transparent p-0 opacity-0 transition-opacity hover:text-foreground",
                                        "group-hover:opacity-100 group-focus-within:opacity-100",
                                        adornmentColor,
                                    )}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onChange?.(undefined, undefined)
                                        setSearch("")
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
                onOpenAutoFocus={(e) => e.preventDefault()}
                onCloseAutoFocus={(e) => e.preventDefault()}
                className={cn("p-0 font-portal", contentClassName)}
                style={{
                    minWidth: panelMinWidth ?? "var(--radix-popover-trigger-width)",
                    maxWidth: panelMaxWidth,
                }}
            >
                <div
                    id={treeId}
                    ref={panelRef}
                    role="tree"
                    aria-label={ariaLabel ?? "Options"}
                    style={{maxHeight: panelMaxHeight}}
                    className="overflow-auto p-1"
                >
                    {rows.length === 0 ? (
                        <div className="py-4 text-center text-field-sm text-placeholder">
                            {emptyText}
                        </div>
                    ) : (
                        rows.map((row, index) => {
                            const {option} = row
                            const selected = hasValue && option.value === value
                            const active = index === focus
                            const selectable = isSelectable(option)
                            return (
                                <div
                                    key={row.key}
                                    id={rowId(index)}
                                    role="treeitem"
                                    aria-level={row.depth + 1}
                                    aria-selected={selected}
                                    aria-expanded={row.branch ? row.expanded : undefined}
                                    aria-disabled={option.disabled || undefined}
                                    data-active={active}
                                    onMouseEnter={() => {
                                        if (option.disabled) return
                                        setFocus(index)
                                    }}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => activate(row)}
                                    className={cn(
                                        // antd option geometry: min-h 28px, 4px×12px padding,
                                        // selected weight 600.
                                        "flex w-full cursor-pointer select-none items-center gap-1 box-border min-h-control rounded-control-sm pr-3 py-1 text-field-md",
                                        // antd: selected row = controlItemBgActive (always); a
                                        // non-selected active/hovered row = controlItemBgHover.
                                        selected ? "bg-controlItemBgActive font-semibold" : "",
                                        !selected && active ? "bg-muted" : "",
                                        option.disabled && "pointer-events-none text-disabled",
                                        !selectable && !row.branch && "cursor-default",
                                    )}
                                >
                                    {Array.from({length: row.depth}, (_, level) => (
                                        <span
                                            key={level}
                                            aria-hidden
                                            className="flex shrink-0 justify-center"
                                            style={{width: indent}}
                                        >
                                            {showLine ? (
                                                <span className="w-px self-stretch bg-border" />
                                            ) : null}
                                        </span>
                                    ))}
                                    <span className="flex w-4 shrink-0 items-center justify-center">
                                        {row.branch ? (
                                            <button
                                                type="button"
                                                tabIndex={-1}
                                                aria-label={row.expanded ? "Collapse" : "Expand"}
                                                className="flex cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-placeholder"
                                                onMouseDown={(e) => e.preventDefault()}
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    toggle(option)
                                                }}
                                            >
                                                <ChevronRight
                                                    className={cn(
                                                        "size-3 transition-transform",
                                                        row.expanded && "rotate-90",
                                                    )}
                                                />
                                            </button>
                                        ) : null}
                                    </span>
                                    <span className="min-w-0 truncate">
                                        {option.label ?? option.value}
                                    </span>
                                </div>
                            )
                        })
                    )}
                </div>
            </PopoverContent>
        </Popover>
    )
}
