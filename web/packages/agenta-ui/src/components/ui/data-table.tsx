import {Fragment, type ReactNode} from "react"

import {ArrowClockwise, DotsThreeVertical} from "@phosphor-icons/react"
import clsx from "clsx"

import {Button} from "./button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
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
    className?: string
}

const CELL = "px-3 py-2 text-xs align-middle"

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
    columns,
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
    className,
}: DataTableProps<T>) {
    const showSkeleton = loading && rows.length === 0
    const showEmpty = !loading && rows.length === 0
    const hasFilterRow = Boolean(search || filters)
    const hasActions = Boolean(onReload || primaryActions)
    const hasHeader = Boolean(title) || hasFilterRow || hasActions

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
                        stickyHeader &&
                            "sticky top-[var(--ag-sticky-top,0px)] z-10 bg-colorBgContainer pb-2 pt-2",
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
                                <Input
                                    placeholder={search.placeholder}
                                    className="w-full sm:w-[260px]"
                                    value={search.value}
                                    onChange={(event) => search.onChange(event.target.value)}
                                    disabled={search.disabled}
                                />
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

            <div className="overflow-x-auto rounded-lg border border-solid border-colorBorderSecondary">
                <table className="w-full border-collapse text-left">
                    <thead>
                        <tr className="border-0 border-b border-solid border-colorBorderSecondary bg-colorFillQuaternary">
                            {columns.map((column) => (
                                <th
                                    key={column.key}
                                    scope="col"
                                    style={column.width ? {width: column.width} : undefined}
                                    className={clsx(
                                        CELL,
                                        "font-medium text-colorTextSecondary",
                                        column.align === "right" && "text-right",
                                        column.align === "center" && "text-center",
                                    )}
                                >
                                    {column.title}
                                </th>
                            ))}
                            {showActions ? <th className={clsx(CELL, "w-12")} /> : null}
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
                                          <td key={column.key} className={CELL}>
                                              <SkeletonBlock active className="h-4 w-3/4" />
                                          </td>
                                      ))}
                                      {showActions ? <td className={CELL} /> : null}
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
                                              {showActions ? (
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
                                                      colSpan={
                                                          columns.length + (showActions ? 1 : 0)
                                                      }
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

/** Already narrowed by `visibleActions` — one row of a table that has actions may still have none. */
const RowActions = <T,>({items, record}: {items: ActionItem<T>[]; record: T}) => {
    if (items.length === 0) return null
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label="Row actions"
                    className="flex size-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-colorTextSecondary hover:bg-colorFillTertiary hover:text-colorText"
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
