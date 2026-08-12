import type {CSSProperties, Key, ReactNode, UIEvent} from "react"
import {isValidElement, useCallback, useEffect, useMemo, useRef, useState} from "react"

import {cn} from "../../utils/styles"
import type {ColumnDef, ColumnDefs, ColumnRenderResult, RenderedColumnCell} from "../columnDef"
import {isColumnGroupDef} from "../columnDef"
import {AVT} from "../tableDom"

/**
 * The antd-free render leaf.
 *
 * Replaces `<Table virtual>` with plain table DOM plus row windowing. It exists because the
 * table is the last antd component in the package, and `/m` — which replaces the desktop apps —
 * cannot ship antd.
 *
 * What antd was actually supplying, and how each part is met here:
 *
 * - **Virtualization** — a fixed row height and a scroll offset decide the visible slice; only
 *   that slice plus an overscan is mounted. Uniform rows make this arithmetic rather than
 *   measurement, which is why a windowing library is not pulled in for it.
 * - **Sticky header** — the header is its own non-scrolling table above the scroller, sharing a
 *   `<colgroup>` with the body so the columns cannot drift.
 * - **Fixed columns** — `position: sticky` with a computed left/right offset per pinned column.
 * - **The DOM contract** — the class hooks and `data-column-key` attributes the package's own
 *   hooks query, so resize, visibility and scroll keep working unchanged.
 */

export interface VirtualTableProps<RecordType extends object> {
    columns: ColumnDefs<RecordType>
    dataSource: RecordType[]
    rowKey: (record: RecordType, index: number) => Key
    rowHeight: number
    /** Body viewport height. Without it the body grows to content and nothing windows. */
    height?: number
    overscan?: number
    onScroll?: (event: UIEvent<HTMLDivElement>) => void
    rowClassName?: (record: RecordType, index: number) => string
    onRow?: (
        record: RecordType,
        index: number,
    ) => {onClick?: (event: React.MouseEvent<HTMLTableRowElement>) => void; className?: string}
    emptyText?: ReactNode
    className?: string
    /** Rendered before the first column — the selection checkbox column. */
    leadingColumnWidth?: number
    renderLeadingCell?: (record: RecordType, index: number) => ReactNode
    renderLeadingHeader?: () => ReactNode
}

/** Groups are flattened for rendering; the leaves are what actually own a cell. */
const flattenLeaves = <RecordType extends object>(
    columns: ColumnDefs<RecordType>,
): ColumnDef<RecordType>[] =>
    columns.flatMap((column) =>
        isColumnGroupDef(column)
            ? flattenLeaves(column.children)
            : [column as ColumnDef<RecordType>],
    )

const widthOf = <RecordType extends object>(column: ColumnDef<RecordType>): number =>
    typeof column.width === "number" ? column.width : (column.minWidth ?? 160)

/**
 * `render` may return a node, or antd's cell-override shape carrying colSpan/rowSpan and cell
 * props. Columns use the second form for merged cells, so both have to be unpacked.
 */
const unpackRender = (
    result: ColumnRenderResult,
): {children: ReactNode; props?: RenderedColumnCell["props"]} => {
    if (result && typeof result === "object" && !isValidElement(result) && "children" in result) {
        const cell = result as RenderedColumnCell
        return {children: cell.children, props: cell.props}
    }
    return {children: result as ReactNode}
}

const cellValue = <RecordType extends object>(
    record: RecordType,
    column: ColumnDef<RecordType>,
) => {
    const path = column.dataIndex
    if (path == null) return undefined
    const keys = Array.isArray(path) ? path : [path]
    return keys.reduce<unknown>(
        (acc, key) => (acc == null ? acc : (acc as Record<string, unknown>)[String(key)]),
        record,
    )
}

/** Left offset for a left-pinned column is the total width of the pinned columns before it. */
const stickyOffsets = <RecordType extends object>(
    leaves: ColumnDef<RecordType>[],
    leadingWidth: number,
) => {
    const left = new Map<number, number>()
    const right = new Map<number, number>()

    let runningLeft = leadingWidth
    leaves.forEach((column, index) => {
        if (column.fixed === "left" || column.fixed === true) {
            left.set(index, runningLeft)
            runningLeft += widthOf(column)
        }
    })

    let runningRight = 0
    for (let index = leaves.length - 1; index >= 0; index -= 1) {
        const column = leaves[index]
        if (column.fixed === "right") {
            right.set(index, runningRight)
            runningRight += widthOf(column)
        }
    }

    return {left, right}
}

export const VirtualTable = <RecordType extends object>({
    columns,
    dataSource,
    rowKey,
    rowHeight,
    height,
    overscan = 6,
    onScroll,
    rowClassName,
    onRow,
    emptyText,
    className,
    leadingColumnWidth = 0,
    renderLeadingCell,
    renderLeadingHeader,
}: VirtualTableProps<RecordType>) => {
    const bodyRef = useRef<HTMLDivElement | null>(null)
    const headerScrollRef = useRef<HTMLDivElement | null>(null)
    const [scrollTop, setScrollTop] = useState(0)

    const leaves = useMemo(() => flattenLeaves(columns).filter((c) => !c.hidden), [columns])
    const offsets = useMemo(
        () => stickyOffsets(leaves, leadingColumnWidth),
        [leaves, leadingColumnWidth],
    )
    const totalWidth = useMemo(
        () => leaves.reduce((sum, c) => sum + widthOf(c), leadingColumnWidth),
        [leaves, leadingColumnWidth],
    )

    const viewportHeight = height ?? 0
    const first = viewportHeight ? Math.max(0, Math.floor(scrollTop / rowHeight) - overscan) : 0
    const visibleCount = viewportHeight
        ? Math.ceil(viewportHeight / rowHeight) + overscan * 2
        : dataSource.length
    const last = Math.min(dataSource.length, first + visibleCount)
    const slice = useMemo(() => dataSource.slice(first, last), [dataSource, first, last])

    // The header is a separate table, so it has to be scrolled in step with the body.
    const handleScroll = useCallback(
        (event: UIEvent<HTMLDivElement>) => {
            const node = event.currentTarget
            setScrollTop(node.scrollTop)
            if (headerScrollRef.current) headerScrollRef.current.scrollLeft = node.scrollLeft
            onScroll?.(event)
        },
        [onScroll],
    )

    // A shrinking dataset can leave the scroller past the new end, which windows to nothing.
    useEffect(() => {
        const node = bodyRef.current
        if (!node) return
        const maxScroll = Math.max(0, dataSource.length * rowHeight - viewportHeight)
        if (node.scrollTop > maxScroll) node.scrollTop = maxScroll
    }, [dataSource.length, rowHeight, viewportHeight])

    const colGroup = (
        <colgroup>
            {leadingColumnWidth ? (
                <col className={AVT.selectionCol} style={{width: leadingColumnWidth}} />
            ) : null}
            {leaves.map((column, index) => (
                <col key={String(column.key ?? index)} style={{width: widthOf(column)}} />
            ))}
        </colgroup>
    )

    const stickyStyle = (index: number): CSSProperties | undefined => {
        const left = offsets.left.get(index)
        if (left !== undefined) return {position: "sticky", left, zIndex: 2}
        const right = offsets.right.get(index)
        if (right !== undefined) return {position: "sticky", right, zIndex: 2}
        return undefined
    }

    return (
        <div className={cn(AVT.container, "flex min-h-0 flex-col overflow-hidden", className)}>
            <div ref={headerScrollRef} className="overflow-hidden">
                <table className="w-full table-fixed border-collapse" style={{width: totalWidth}}>
                    {colGroup}
                    <thead className={AVT.header}>
                        <tr>
                            {leadingColumnWidth ? (
                                <th
                                    className={cn(
                                        AVT.headerCell,
                                        "box-border border-0 border-b border-solid border-colorBorderSecondary bg-colorBgContainer px-2 py-2 text-left",
                                    )}
                                    style={{position: "sticky", left: 0, zIndex: 3}}
                                >
                                    {renderLeadingHeader?.()}
                                </th>
                            ) : null}
                            {leaves.map((column, index) => {
                                const props = column.onHeaderCell?.(column, index) ?? {}
                                return (
                                    <th
                                        {...props}
                                        key={String(column.key ?? index)}
                                        data-column-key={String(column.key ?? index)}
                                        className={cn(
                                            AVT.headerCell,
                                            "box-border border-0 border-b border-solid border-colorBorderSecondary bg-colorBgContainer px-3 py-2 text-left text-field-md font-medium text-colorText",
                                            column.ellipsis && "truncate",
                                            column.className,
                                            props.className,
                                        )}
                                        style={{
                                            ...stickyStyle(index),
                                            textAlign: column.align,
                                            ...props.style,
                                        }}
                                    >
                                        {typeof column.title === "function"
                                            ? column.title({})
                                            : column.title}
                                    </th>
                                )
                            })}
                        </tr>
                    </thead>
                </table>
            </div>

            <div
                ref={bodyRef}
                className={cn(AVT.body, "min-h-0 flex-1 overflow-auto")}
                style={height ? {height} : undefined}
                onScroll={handleScroll}
            >
                {dataSource.length === 0 ? (
                    <div className="flex items-center justify-center py-10">{emptyText}</div>
                ) : (
                    <div style={{height: dataSource.length * rowHeight, position: "relative"}}>
                        <table
                            className="absolute left-0 w-full table-fixed border-collapse"
                            style={{width: totalWidth, top: first * rowHeight}}
                        >
                            {colGroup}
                            <tbody>
                                {slice.map((record, sliceIndex) => {
                                    const index = first + sliceIndex
                                    const rowProps = onRow?.(record, index) ?? {}
                                    return (
                                        <tr
                                            {...rowProps}
                                            key={String(rowKey(record, index))}
                                            style={{height: rowHeight}}
                                            className={cn(
                                                AVT.row,
                                                "border-0 border-b border-solid border-colorBorderSecondary hover:bg-colorFillTertiary",
                                                rowClassName?.(record, index),
                                                rowProps.className,
                                            )}
                                        >
                                            {leadingColumnWidth ? (
                                                <td
                                                    className={cn(
                                                        AVT.cell,
                                                        "box-border bg-colorBgContainer px-2 align-middle",
                                                    )}
                                                    style={{position: "sticky", left: 0, zIndex: 1}}
                                                >
                                                    {renderLeadingCell?.(record, index)}
                                                </td>
                                            ) : null}
                                            {leaves.map((column, columnIndex) => {
                                                const props = column.onCell?.(record, index) ?? {}
                                                const value = cellValue(record, column)
                                                const rendered = column.render
                                                    ? unpackRender(
                                                          column.render(value, record, index),
                                                      )
                                                    : {children: value as ReactNode}
                                                if (rendered.props?.colSpan === 0) return null
                                                return (
                                                    <td
                                                        {...props}
                                                        {...rendered.props}
                                                        key={String(column.key ?? columnIndex)}
                                                        className={cn(
                                                            AVT.cell,
                                                            "box-border bg-colorBgContainer px-3 align-top text-field-md text-colorText",
                                                            column.ellipsis && "truncate",
                                                            column.className,
                                                            props.className,
                                                        )}
                                                        style={{
                                                            ...stickyStyle(columnIndex),
                                                            textAlign: column.align,
                                                            ...props.style,
                                                        }}
                                                    >
                                                        {rendered.children}
                                                    </td>
                                                )
                                            })}
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    )
}

export default VirtualTable
