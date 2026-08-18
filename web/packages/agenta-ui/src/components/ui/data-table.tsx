import {Fragment, useEffect, useMemo, useRef, useState, type ReactNode} from "react"

import {ArrowClockwise, DotsThreeVertical, Gear, MagnifyingGlass} from "@phosphor-icons/react"
import clsx from "clsx"

import {Button} from "./button"
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "./dropdown-menu"
import {Input} from "./input"
import {SkeletonBlock} from "./skeleton"
import {SimpleTooltip} from "./tooltip-composed"

export interface DataTableColumn<T> {
    key: string
    title?: ReactNode
    /** Fixed pixel width. Omit to share the remaining space. */
    width?: number
    align?: "left" | "right" | "center"
    /** Monospace + tabular figures — ids, prefixes, slugs. */
    mono?: boolean
    className?: string
    /**
     * Offer this column in the column-settings menu. The first column identifies the row, so
     * it defaults to locked; every other column defaults to hideable.
     */
    hideable?: boolean
    /**
     * Share the table's surplus width. The first column identifies the row and defaults to
     * `false` — it keeps exactly its declared `width`, as a pinned column does — so surplus
     * lands on the columns whose content actually varies.
     */
    flexible?: boolean
    render: (record: T) => ReactNode
}

export interface DataTableAction<T> {
    key: string
    label: ReactNode
    icon?: ReactNode
    danger?: boolean
    disabled?: boolean
    /** Drop the item entirely for this row — e.g. "Set as default" on the default row. */
    hidden?: boolean
    onClick: (record: T) => void
}

export interface DataTableSearch {
    placeholder: string
    value: string
    onChange: (value: string) => void
    disabled?: boolean
}

export interface DataTableProps<T> {
    columns: DataTableColumn<T>[]
    rows: T[]
    rowKey: (record: T) => string
    /**
     * Per-row overflow menu, rendered as a trailing column. The column appears only when at
     * least one row has a visible item, so a host that supplies no verbs gets no gutter and no
     * kebab — callers can pass the full list and lean on `hidden`.
     */
    actions?: (record: T) => (DataTableAction<T> | {type: "divider"})[]
    /** Shown instead of rows when there are none and nothing is loading. */
    empty?: ReactNode
    loading?: boolean
    skeletonRows?: number
    /**
     * The toolbar's search box. Pass this rather than an `Input` in `filters`: every list
     * searches the same way, at the same width, in the same place.
     */
    search?: DataTableSearch
    /** Left of the toolbar, after the search — this list's own filters. */
    filters?: ReactNode
    /**
     * The toolbar's reload control. Pass this rather than a button in `primaryActions`: it
     * renders first in the right group, so refresh sits in one place on every list.
     */
    onReload?: () => void
    /** Reload is in flight — disables the control. */
    reloading?: boolean
    /** Tooltip and accessible name for reload, e.g. "Reload webhooks". */
    reloadLabel?: string
    /** Right of the toolbar, after reload — this list's primary buttons. */
    primaryActions?: ReactNode
    /** Above the toolbar — a heading for the table itself. */
    title?: ReactNode
    onRowClick?: (record: T) => void
    /**
     * Detail rendered in a full-width row beneath the record. Return null for rows that have
     * none — there is no expand/collapse control, so use this for detail that should always
     * show (setup instructions, a pending state), not for optional drill-down.
     */
    expandedContent?: (record: T) => ReactNode
    /**
     * Pin the header area — the title and the toolbar — to the top of the scroll container
     * while this section's rows scroll past. On by default: a settings page stacks several
     * sections, and scrolling into a long one otherwise leaves rows with nothing naming them
     * or acting on them. Turn it off for a table on a surface the page background would clash
     * with (the bar has to paint opaquely to cover the rows sliding under it).
     */
    stickyHeader?: boolean
    /**
     * The ⚙ in the header row that shows/hides columns. On by default, as it is on every
     * desktop settings table. State is per-mount — the desktop app persists it per table
     * scope, which this deliberately does not carry.
     */
    columnSettings?: boolean
    className?: string
}

// 14px/20px is antd's configured Table `fontSize`/`lineHeight` (antd-themeConfig.json), and 8px
// is the `size="small"` cell padding — measured on the desktop table's own `th`, which pads 8px
// where this was padding 12 and pushed every cell's text 4px right of the column rule.
const CELL = "px-2 py-2 text-[14px] leading-[20px] align-middle"

// Vertical rules between cells, matching antd's `bordered` table. The last cell is left open
// so the rule never doubles up with the container's own border.
const CELL_DIVIDER = "border-0 border-r border-solid border-colorBorderSecondary last:border-r-0"

/** The trailing kebab / ⚙ gutter. 56px is what the desktop app reserves for it. */
const ACTIONS_COL_WIDTH = 56

/**
 * `<colgroup>` widths that reproduce the desktop table's distribution.
 *
 * Under `table-layout: fixed` a browser hands surplus width to EVERY column with a declared
 * width, in proportion — so an identity column declared at 280px rendered at 402px and shifted
 * every cell after it. The desktop app pins that column (it is `fixed: "left"` there) and gives
 * the surplus only to the flexible ones.
 *
 * Stated in px off a measured container rather than in `calc()`: a `<col>` width mixing % and
 * px is silently dropped (Chrome falls back to equal shares — measured 391/391 where the
 * desktop app renders 505/279). `containerWidth` 0 means "not measured yet", and the declared
 * widths are used as-is for that first paint.
 */
export const columnWidths = <T,>(
    columns: DataTableColumn<T>[],
    actionsWidth: number,
    containerWidth: number,
): (number | undefined)[] => {
    const isFlexible = (column: DataTableColumn<T>, index: number) =>
        (column.flexible ?? index > 0) && Boolean(column.width)
    const pinned = columns.reduce(
        (total, column, index) => (isFlexible(column, index) ? total : total + (column.width ?? 0)),
        actionsWidth,
    )
    const flexTotal = columns.reduce(
        (total, column, index) => (isFlexible(column, index) ? total + (column.width ?? 0) : total),
        0,
    )
    const surplus = containerWidth - pinned
    // Nothing to share (unmeasured, or the columns already overflow) — declared widths stand.
    const share = containerWidth > 0 && flexTotal > 0 && surplus > flexTotal ? surplus : flexTotal

    return columns.map((column, index) => {
        if (!column.width) return undefined
        if (!isFlexible(column, index)) return column.width
        return Math.round((share * column.width) / flexTotal)
    })
}

type ActionItem<T> = DataTableAction<T> | {type: "divider"}

/**
 * The items a row will actually show: `hidden` ones are dropped, and a divider only survives
 * with a real item on both sides. Returns an empty list when nothing is left — a read-only host
 * hides every verb, and an empty menu is worse than no menu.
 */
const visibleActions = <T,>(items: ActionItem<T>[]): ActionItem<T>[] => {
    const visible = items.filter((item) => "type" in item || !item.hidden)
    // Hiding every action can leave a divider stranded at either end.
    const trimmed = visible.filter(
        (item, index) =>
            !("type" in item) ||
            (visible.slice(0, index).some((prior) => !("type" in prior)) &&
                visible.slice(index + 1).some((next) => !("type" in next))),
    )
    return trimmed.some((item) => !("type" in item)) ? trimmed : []
}

/**
 * THE antd-free table for fully-materialized lists — settings, and anything else whose rows are
 * already in memory.
 *
 * Deliberately not virtualized: `InfiniteVirtualTable` exists for large, paged, server-driven
 * datasets and is antd-backed. Settings tables are small, single-page and fully loaded, so they
 * pay none of that cost — and, crucially, can render in a host that forbids antd.
 */
export function DataTable<T>({
    columns: allColumns,
    rows,
    rowKey,
    actions,
    empty,
    loading = false,
    skeletonRows = 5,
    search,
    filters,
    onReload,
    reloading = false,
    reloadLabel = "Reload",
    primaryActions,
    title,
    onRowClick,
    expandedContent,
    stickyHeader = true,
    columnSettings = true,
    className,
}: DataTableProps<T>) {
    const [hiddenKeys, setHiddenKeys] = useState<string[]>([])
    // Measured, because the surplus a flexible column takes can only be stated in px.
    const scrollRef = useRef<HTMLDivElement>(null)
    const [tableWidth, setTableWidth] = useState(0)

    useEffect(() => {
        const node = scrollRef.current
        if (!node || typeof ResizeObserver === "undefined") return
        const observer = new ResizeObserver(([entry]) => setTableWidth(entry.contentRect.width))
        observer.observe(node)
        return () => observer.disconnect()
    }, [])

    // The first column names the row, so hiding it would leave anonymous rows.
    const hideable = useMemo(
        () => allColumns.filter((column, index) => column.hideable ?? index > 0),
        [allColumns],
    )
    const columns = useMemo(
        () => allColumns.filter((column) => !hiddenKeys.includes(column.key)),
        [allColumns, hiddenKeys],
    )
    const showColumnSettings = columnSettings && hideable.length > 0

    const showSkeleton = loading && rows.length === 0
    const showEmpty = !loading && rows.length === 0
    const hasFilterRow = Boolean(search || filters)
    const hasActions = Boolean(onReload || primaryActions)
    const hasHeader = Boolean(title) || hasFilterRow || hasActions

    // Resolved once per render, per row: `actions` is a function of the record, so a host can
    // hide a verb per row. The trailing column exists only if SOME row has something to show —
    // an all-hidden table should not pay for an empty gutter.
    const rowActions = actions ? rows.map((record) => visibleActions(actions(record))) : undefined
    const showActions = Boolean(rowActions?.some((items) => items.length > 0))
    const hasGutter = showActions || showColumnSettings
    const colWidths = useMemo(
        () => columnWidths(columns, hasGutter ? ACTIONS_COL_WIDTH : 0, tableWidth),
        [columns, hasGutter, tableWidth],
    )

    const reloadButton = onReload ? (
        <SimpleTooltip title={reloadLabel}>
            <Button
                variant="outline"
                aria-label={reloadLabel}
                disabled={reloading}
                onClick={() => onReload()}
            >
                <ArrowClockwise size={14} />
            </Button>
        </SimpleTooltip>
    ) : null

    // The empty state carries its own call to action, and on a phone the two sit far enough
    // apart to read as different controls — so show only that one.
    const primaryGroup = primaryActions ? (
        <div
            className={clsx(
                "flex items-center gap-2 max-sm:w-full max-sm:[&>*]:flex-1",
                showEmpty && empty && "max-sm:hidden",
            )}
        >
            {primaryActions}
        </div>
    ) : null

    return (
        <div className={clsx("flex min-w-0 flex-col gap-2", className)}>
            {hasHeader ? (
                <div
                    className={clsx(
                        "flex flex-col gap-2",
                        // Sticks within its own section, so the next section's header takes
                        // over as that one arrives rather than stacking on top of this one.
                        // `--ag-sticky-top` is whatever the page pins above it (the Settings
                        // shell publishes its header height); 0 when nothing does.
                        //
                        // `-mt-2` cancels `pt-2` so the resting layout is unchanged and the
                        // clearance is bought only once the bar is stuck (the same trick the
                        // Settings shell uses on its own header). Paying that padding at rest
                        // pushed the toolbar 8px down and the table 8px further on every
                        // settings page. The 8px below comes from the wrapper's `gap-2`.
                        stickyHeader &&
                            "sticky top-[var(--ag-sticky-top,0px)] z-10 -mt-2 bg-colorBgContainer pt-2",
                    )}
                >
                    {title || (hasActions && !hasFilterRow) ? (
                        // `min-h` holds the row's height when a host suppresses the actions (a
                        // read-only surface), so the rhythm from header to table does not
                        // change tab to tab.
                        //
                        // Reload keeps the title's line at every width — an icon button does not
                        // earn a row of its own. The primary button is wide enough to want one,
                        // so below sm it wraps full-width; from sm it rejoins the line.
                        <div className="flex min-h-control flex-wrap items-start gap-2">
                            {title ? <div className="min-w-0 flex-1">{title}</div> : null}
                            {title || !hasFilterRow ? (
                                <>
                                    {reloadButton ? (
                                        <div className="shrink-0">{reloadButton}</div>
                                    ) : null}
                                    {primaryGroup}
                                </>
                            ) : null}
                        </div>
                    ) : null}

                    {hasFilterRow ? (
                        // Search then filters on the left; the actions join this row only when
                        // there is no title above to carry them.
                        <div className="flex min-h-control flex-wrap items-center gap-2">
                            {search ? (
                                // Input + attached magnifier button, as antd's `Input.Search`
                                // draws it: the button is the affordance that says "this box
                                // searches", and a bare input lost it. Filtering is live, so
                                // the button only re-asserts the current term.
                                <div className="flex w-full sm:w-[260px]">
                                    <Input
                                        placeholder={search.placeholder}
                                        className="min-w-0 flex-1 rounded-r-none"
                                        value={search.value}
                                        onChange={(event) => search.onChange(event.target.value)}
                                        disabled={search.disabled}
                                    />
                                    {/* 28px wide, not a default-padded button: `Input.Search`
                                        gives the button 27px and the field the other 233 of
                                        the 260, and a text-sized button ate 45.
                                        `self-stretch h-auto` rather than a height: `Input`
                                        DERIVES its height from padding + line-height (30px)
                                        while `h-control` is 28, so a button honouring the
                                        token sat 2px short and left a step at the seam. */}
                                    <Button
                                        variant="outline"
                                        aria-label={search.placeholder}
                                        disabled={search.disabled}
                                        className="-ml-px h-auto w-7 shrink-0 self-stretch rounded-l-none p-0"
                                        onClick={() => search.onChange(search.value)}
                                    >
                                        <MagnifyingGlass size={14} />
                                    </Button>
                                </div>
                            ) : null}
                            {filters}
                            {title ? null : (
                                <div className="flex shrink-0 items-center gap-2 sm:ml-auto">
                                    {reloadButton}
                                    {primaryGroup}
                                </div>
                            )}
                        </div>
                    ) : null}
                </div>
            ) : null}

            <div
                ref={scrollRef}
                className="overflow-x-auto rounded-lg border border-solid border-colorBorderSecondary"
            >
                {/* `table-fixed` honours the declared column widths. Under `auto` they are
                    only hints, so every column landed at a different x than the desktop app's
                    and the same table read differently on the two builds. */}
                <table className="w-full table-fixed border-collapse text-left">
                    <colgroup>
                        {colWidths.map((width, index) => (
                            <col key={columns[index].key} style={{width}} />
                        ))}
                        {hasGutter ? <col style={{width: ACTIONS_COL_WIDTH}} /> : null}
                    </colgroup>
                    <thead>
                        <tr className="border-0 border-b border-solid border-colorBorderSecondary bg-colorFillQuaternary">
                            {columns.map((column) => (
                                <th
                                    key={column.key}
                                    scope="col"
                                    className={clsx(
                                        CELL,
                                        CELL_DIVIDER,
                                        "font-semibold text-colorText",
                                        column.align === "right" && "text-right",
                                        column.align === "center" && "text-center",
                                    )}
                                >
                                    {column.title}
                                </th>
                            ))}
                            {hasGutter ? (
                                <th className={clsx(CELL, "text-right")}>
                                    {showColumnSettings ? (
                                        <ColumnSettings
                                            columns={hideable}
                                            hiddenKeys={hiddenKeys}
                                            onToggle={(key) =>
                                                setHiddenKeys((current) =>
                                                    current.includes(key)
                                                        ? current.filter((k) => k !== key)
                                                        : [...current, key],
                                                )
                                            }
                                            onSetAll={(hidden) =>
                                                setHiddenKeys(
                                                    hidden
                                                        ? hideable.map((column) => column.key)
                                                        : [],
                                                )
                                            }
                                        />
                                    ) : null}
                                </th>
                            ) : null}
                        </tr>
                    </thead>
                    <tbody>
                        {showSkeleton
                            ? Array.from({length: skeletonRows}, (_, index) => (
                                  <tr
                                      key={`skeleton-${index}`}
                                      className="border-0 border-b border-solid border-colorBorderSecondary last:border-b-0"
                                  >
                                      {columns.map((column) => (
                                          <td key={column.key} className={clsx(CELL, CELL_DIVIDER)}>
                                              <SkeletonBlock active className="h-4 w-3/4" />
                                          </td>
                                      ))}
                                      {hasGutter ? <td className={CELL} /> : null}
                                  </tr>
                              ))
                            : rows.map((record, rowIndex) => {
                                  const detail = expandedContent?.(record)
                                  const items = rowActions?.[rowIndex] ?? []
                                  return (
                                      <Fragment key={rowKey(record)}>
                                          <tr
                                              onClick={
                                                  onRowClick ? () => onRowClick(record) : undefined
                                              }
                                              // A clickable row is a control, so it takes focus and
                                              // answers Enter/Space like one. Rows without
                                              // `onRowClick` stay plain markup — they must not
                                              // become focus stops.
                                              role={onRowClick ? "button" : undefined}
                                              tabIndex={onRowClick ? 0 : undefined}
                                              onKeyDown={
                                                  onRowClick
                                                      ? (event) => {
                                                            // Only the row itself: controls inside
                                                            // a cell handle their own keys, and
                                                            // Space on a container that does not
                                                            // preventDefault also scrolls the page.
                                                            if (
                                                                event.target !== event.currentTarget
                                                            )
                                                                return
                                                            if (
                                                                event.key !== "Enter" &&
                                                                event.key !== " "
                                                            )
                                                                return
                                                            event.preventDefault()
                                                            onRowClick(record)
                                                        }
                                                      : undefined
                                              }
                                              className={clsx(
                                                  "border-0 border-b border-solid border-colorBorderSecondary last:border-b-0 hover:bg-colorFillQuaternary",
                                                  onRowClick &&
                                                      "cursor-pointer outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring",
                                                  // The detail row carries the boundary instead.
                                                  detail && "border-b-0",
                                              )}
                                          >
                                              {columns.map((column) => (
                                                  <td
                                                      key={column.key}
                                                      className={clsx(
                                                          CELL,
                                                          CELL_DIVIDER,
                                                          "text-colorText",
                                                          column.mono && "font-mono tabular-nums",
                                                          column.align === "right" && "text-right",
                                                          column.align === "center" &&
                                                              "text-center",
                                                          column.className,
                                                      )}
                                                  >
                                                      {column.render(record)}
                                                  </td>
                                              ))}
                                              {hasGutter ? (
                                                  <td
                                                      className={clsx(CELL, "text-right")}
                                                      onClick={(event) => event.stopPropagation()}
                                                  >
                                                      <RowActions items={items} record={record} />
                                                  </td>
                                              ) : null}
                                          </tr>
                                          {detail ? (
                                              <tr className="border-0 border-b border-solid border-colorBorderSecondary last:border-b-0">
                                                  <td
                                                      colSpan={columns.length + (hasGutter ? 1 : 0)}
                                                      className="px-3 pb-3 pt-0"
                                                  >
                                                      {detail}
                                                  </td>
                                              </tr>
                                          ) : null}
                                      </Fragment>
                                  )
                              })}
                    </tbody>
                </table>

                {showEmpty ? <div className="px-3 py-5 sm:py-8">{empty}</div> : null}
            </div>
        </div>
    )
}

/**
 * The ⚙ that shows and hides columns, in the header row's trailing cell — where the desktop
 * app has always put it. Only `hideable` columns are listed, so the column naming the row
 * cannot be turned off.
 *
 * The desktop popover is titled VISIBILITY and adds Expand all / Collapse all / Reset layout
 * alongside Show all / Hide all. Those three belong to column GROUPING and RESIZING, neither of
 * which this table has, so only the visibility half is mirrored here.
 */
const ColumnSettings = <T,>({
    columns,
    hiddenKeys,
    onToggle,
    onSetAll,
}: {
    columns: DataTableColumn<T>[]
    hiddenKeys: string[]
    onToggle: (key: string) => void
    onSetAll: (hidden: boolean) => void
}) => {
    const allShown = columns.every((column) => !hiddenKeys.includes(column.key))
    const allHidden = columns.every((column) => hiddenKeys.includes(column.key))
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label="Column settings"
                    className="flex size-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-colorTextSecondary hover:bg-colorFillTertiary hover:text-colorText"
                >
                    <Gear size={16} />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[180px]">
                <DropdownMenuLabel>Visibility</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={allShown} onSelect={() => onSetAll(false)}>
                    Show all
                </DropdownMenuItem>
                <DropdownMenuItem disabled={allHidden} onSelect={() => onSetAll(true)}>
                    Hide all
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {columns.map((column) => (
                    <DropdownMenuCheckboxItem
                        key={column.key}
                        checked={!hiddenKeys.includes(column.key)}
                        // Keep the menu open: hiding several columns in a row is the normal use.
                        onSelect={(event) => event.preventDefault()}
                        onCheckedChange={() => onToggle(column.key)}
                    >
                        {column.title}
                    </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

/** Already narrowed by `visibleActions` — one row of a table that has actions may still have none. */
const RowActions = <T,>({items, record}: {items: ActionItem<T>[]; record: T}) => {
    if (items.length === 0) return null
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                {/* 30x24, the desktop table's own trigger. At 28 tall it was the tallest thing
                    in the row and set the row's height, making every table row 45px against
                    prod's 41 — the other cells cap out at the 24px avatar. */}
                <button
                    type="button"
                    aria-label="Row actions"
                    className="flex h-6 w-[30px] cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-colorTextSecondary hover:bg-colorFillTertiary hover:text-colorText"
                >
                    <DotsThreeVertical size={16} weight="bold" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[180px]">
                {items.map((item, index) =>
                    "type" in item ? (
                        <DropdownMenuSeparator key={`divider-${index}`} />
                    ) : (
                        <DropdownMenuItem
                            key={item.key}
                            disabled={item.disabled}
                            className={clsx(item.danger && !item.disabled && "!text-colorError")}
                            onSelect={() => item.onClick(record)}
                        >
                            {item.icon}
                            {item.label}
                        </DropdownMenuItem>
                    ),
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
