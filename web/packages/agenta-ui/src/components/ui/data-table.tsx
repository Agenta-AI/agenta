import {Fragment, type ReactNode} from "react"

import {DotsThreeVertical} from "@phosphor-icons/react"
import clsx from "clsx"

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "./dropdown-menu"
import {SkeletonBlock} from "./skeleton"

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

export interface DataTableProps<T> {
    columns: DataTableColumn<T>[]
    rows: T[]
    rowKey: (record: T) => string
    /** Per-row overflow menu, rendered as a trailing column. */
    actions?: (record: T) => (DataTableAction<T> | {type: "divider"})[]
    /** Shown instead of rows when there are none and nothing is loading. */
    empty?: ReactNode
    loading?: boolean
    skeletonRows?: number
    /** Left of the toolbar — search and filters. */
    filters?: ReactNode
    /** Right of the toolbar — the primary buttons. */
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
    className?: string
}

const CELL = "px-3 py-2 text-xs align-middle"

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
    filters,
    primaryActions,
    title,
    onRowClick,
    expandedContent,
    className,
}: DataTableProps<T>) {
    const showSkeleton = loading && rows.length === 0
    const showEmpty = !loading && rows.length === 0

    return (
        <div className={clsx("flex min-w-0 flex-col gap-2", className)}>
            {title ? <div>{title}</div> : null}

            {filters || primaryActions ? (
                <div className="flex flex-wrap items-center gap-2">
                    {filters}
                    <div className="ml-auto flex items-center gap-2">{primaryActions}</div>
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
                            {actions ? <th className={clsx(CELL, "w-12")} /> : null}
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
                                      {actions ? <td className={CELL} /> : null}
                                  </tr>
                              ))
                            : rows.map((record) => {
                                  const detail = expandedContent?.(record)
                                  return (
                                      <Fragment key={rowKey(record)}>
                                          <tr
                                              onClick={
                                                  onRowClick ? () => onRowClick(record) : undefined
                                              }
                                              className={clsx(
                                                  "border-0 border-b border-solid border-colorBorderSecondary last:border-b-0 hover:bg-colorFillQuaternary",
                                                  onRowClick && "cursor-pointer",
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
                                              {actions ? (
                                                  <td
                                                      className={clsx(CELL, "text-right")}
                                                      onClick={(event) => event.stopPropagation()}
                                                  >
                                                      <RowActions
                                                          items={actions(record)}
                                                          record={record}
                                                      />
                                                  </td>
                                              ) : null}
                                          </tr>
                                          {detail ? (
                                              <tr className="border-0 border-b border-solid border-colorBorderSecondary last:border-b-0">
                                                  <td
                                                      colSpan={columns.length + (actions ? 1 : 0)}
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

                {showEmpty ? <div className="px-3 py-8">{empty}</div> : null}
            </div>
        </div>
    )
}

const RowActions = <T,>({
    items,
    record,
}: {
    items: (DataTableAction<T> | {type: "divider"})[]
    record: T
}) => {
    const visible = items.filter((item) => "type" in item || !item.hidden)
    // Hiding every action can leave a divider stranded at either end.
    const trimmed = visible.filter(
        (item, index) =>
            !("type" in item) ||
            (visible.slice(0, index).some((prior) => !("type" in prior)) &&
                visible.slice(index + 1).some((next) => !("type" in next))),
    )
    if (!trimmed.some((item) => !("type" in item))) return null
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
                {trimmed.map((item, index) =>
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
