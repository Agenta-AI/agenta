import {Fragment, type ReactNode} from "react"

import clsx from "clsx"

/**
 * A small static table with optional expandable rows.
 *
 * The annotations panel rendered an antd `Table` with `expandable`, which is far more machinery
 * than a fixed list of annotations needs and drags antd into a package that must stay free of
 * it. The column descriptor keeps antd's shape (`title`/`dataIndex`/`render`/`width`) so the
 * existing column factory needed no rewrite.
 *
 * Not a replacement for `InfiniteVirtualTable` — there is no virtualization, sorting or paging
 * here on purpose; reach for that one when a table has unbounded rows.
 */
export interface SimpleColumn<T> {
    title: ReactNode
    key: string
    dataIndex?: string
    width?: number
    render?: (value: unknown, record: T, index: number) => ReactNode
    /** antd column fields the descriptors still carry; accepted and ignored here. */
    align?: "start" | "center" | "end" | "left" | "right"
    fixed?: "left" | "right" | boolean
    onHeaderCell?: unknown
    onCell?: unknown
    /** antd column groups; the children render as their own columns here. */
    children?: SimpleColumn<T>[]
}

export interface SimpleTableProps<T> {
    columns: SimpleColumn<T>[]
    dataSource: T[]
    rowKey: keyof T | ((record: T) => string)
    className?: string
    /** Renders under a row, spanning every column — antd's `expandable.expandedRowRender`. */
    expandedRowRender?: (record: T) => ReactNode
    bordered?: boolean
}

const keyOf = <T,>(record: T, rowKey: SimpleTableProps<T>["rowKey"], index: number): string => {
    if (typeof rowKey === "function") return rowKey(record)
    const value = (record as Record<string, unknown>)[rowKey as string]
    return value == null ? String(index) : String(value)
}

export const SimpleTable = <T,>({
    columns: incomingColumns,
    dataSource,
    rowKey,
    className,
    expandedRowRender,
    bordered = false,
}: SimpleTableProps<T>) => {
    // antd rendered a column group as a header span over its children; flattened here.
    const columns = incomingColumns.flatMap((column) => column.children ?? [column])

    return (
        <div className={clsx("w-full overflow-x-auto", className)}>
            <table className="w-full border-collapse text-field-md">
                <thead>
                    <tr>
                        {columns.map((column) => (
                            <th
                                key={column.key}
                                style={column.width ? {width: column.width} : undefined}
                                className={clsx(
                                    "text-left font-medium px-2 py-2 bg-colorFillTertiary",
                                    bordered && "border border-solid border-colorBorderSecondary",
                                )}
                            >
                                {column.title}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {dataSource.map((record, index) => (
                        <Fragment key={keyOf(record, rowKey, index)}>
                            <tr>
                                {columns.map((column) => {
                                    const raw = column.dataIndex
                                        ? (record as Record<string, unknown>)[column.dataIndex]
                                        : undefined
                                    return (
                                        <td
                                            key={column.key}
                                            className={clsx(
                                                "px-2 py-2 align-top",
                                                bordered &&
                                                    "border border-solid border-colorBorderSecondary",
                                            )}
                                        >
                                            {column.render
                                                ? column.render(raw, record, index)
                                                : (raw as ReactNode)}
                                        </td>
                                    )
                                })}
                            </tr>
                            {expandedRowRender ? (
                                <tr>
                                    {/* antd stripped the expanded cell's padding; so does this. */}
                                    <td
                                        colSpan={columns.length}
                                        className={clsx(
                                            "p-0 bg-colorFillTertiary",
                                            bordered &&
                                                "border border-solid border-colorBorderSecondary",
                                        )}
                                    >
                                        {expandedRowRender(record)}
                                    </td>
                                </tr>
                            ) : null}
                        </Fragment>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

export default SimpleTable
