import type {ReactNode} from "react"

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
    className,
}: DataTableProps<T>) {
    const showSkeleton = loading && rows.length === 0
    const showEmpty = !loading && rows.length === 0

    return (
        <div className={clsx("flex min-w-0 flex-col gap-2", className)}>
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
                            : rows.map((record) => (
                                  <tr
                                      key={rowKey(record)}
                                      className="border-0 border-b border-solid border-colorBorderSecondary last:border-b-0 hover:bg-colorFillQuaternary"
                                  >
                                      {columns.map((column) => (
                                          <td
                                              key={column.key}
                                              className={clsx(
                                                  CELL,
                                                  "text-colorText",
                                                  column.mono && "font-mono tabular-nums",
                                                  column.align === "right" && "text-right",
                                                  column.align === "center" && "text-center",
                                                  column.className,
                                              )}
                                          >
                                              {column.render(record)}
                                          </td>
                                      ))}
                                      {actions ? (
                                          <td className={clsx(CELL, "text-right")}>
                                              <RowActions
                                                  items={actions(record)}
                                                  record={record}
                                              />
                                          </td>
                                      ) : null}
                                  </tr>
                              ))}
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
                            className={clsx(item.danger && "!text-colorError")}
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
