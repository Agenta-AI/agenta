import type {CSSProperties, Key, ReactNode, UIEvent} from "react"
import {isValidElement, useCallback, useMemo, useRef} from "react"

import type {
    ColumnSizingState,
    OnChangeFn,
    RowSelectionState,
    VisibilityState,
} from "@tanstack/react-table"
import {flexRender, getCoreRowModel, useReactTable} from "@tanstack/react-table"
import {useVirtualizer} from "@tanstack/react-virtual"

import {cn} from "../../utils/styles"
import type {ColumnDefs, ColumnRenderResult, RenderedColumnCell} from "../columnDef"
import useInfiniteScroll from "../hooks/useInfiniteScroll"
import {AVT} from "../tableDom"
import {sourceOf, toTanstackColumns} from "../tanstackColumns"

/**
 * The antd-free render leaf.
 *
 * TanStack Table owns the model (columns, visibility, sizing, selection) and TanStack Virtual
 * owns the windowing; this file owns only the markup. That split is the point: the model logic
 * it replaces was ~1,500 lines of bespoke hooks in this package, and the rendering is the part
 * that has to emit *our* DOM contract, which no library can do for us.
 *
 * - **Virtualization** — `useVirtualizer` MEASURES rows, so unlike a fixed-height window this
 *   copes with rows whose height comes from their content. `rowHeight` is only an estimate.
 * - **Sticky header** — its own table above the scroller, sharing column widths with the body.
 * - **Fixed columns** — `position: sticky` at an offset accumulated across pinned columns.
 * - **The DOM contract** — the `avt-*` hooks and `data-column-key` attributes this package's
 *   own hooks query, so resize, visibility and scroll keep working unchanged.
 */

export interface VirtualTableProps<RecordType extends object> {
    columns: ColumnDefs<RecordType>
    dataSource: RecordType[]
    rowKey: (record: RecordType, index: number) => Key
    /** Starting row height. Rows are measured after mount, so this only needs to be close. */
    rowHeight: number
    /** Body viewport height. Without it the body fills its flex parent instead. */
    height?: number
    overscan?: number
    /** Called when the body scrolls within `scrollThreshold` of the bottom. */
    loadMore?: () => void
    /** Distance from the bottom, in px, that triggers `loadMore`. */
    scrollThreshold?: number
    onScroll?: (event: UIEvent<HTMLDivElement>) => void
    rowClassName?: (record: RecordType, index: number) => string
    onRow?: (
        record: RecordType,
        index: number,
    ) => {onClick?: (event: React.MouseEvent<HTMLTableRowElement>) => void; className?: string}
    emptyText?: ReactNode
    className?: string
    /** Controlled column visibility, keyed by column id. */
    columnVisibility?: VisibilityState
    onColumnVisibilityChange?: OnChangeFn<VisibilityState>
    /** Controlled column widths, keyed by column id. */
    columnSizing?: ColumnSizingState
    onColumnSizingChange?: OnChangeFn<ColumnSizingState>
    /** Controlled row selection, keyed by row id. */
    rowSelection?: RowSelectionState
    onRowSelectionChange?: OnChangeFn<RowSelectionState>
    /** Rendered before the first column — the selection checkbox column. */
    leadingColumnWidth?: number
    renderLeadingCell?: (record: RecordType, index: number) => ReactNode
    renderLeadingHeader?: () => ReactNode
}

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

export const VirtualTable = <RecordType extends object>({
    columns,
    dataSource,
    rowKey,
    rowHeight,
    height,
    overscan = 8,
    loadMore,
    scrollThreshold = 300,
    onScroll,
    rowClassName,
    onRow,
    emptyText,
    className,
    columnVisibility,
    onColumnVisibilityChange,
    columnSizing,
    onColumnSizingChange,
    rowSelection,
    onRowSelectionChange,
    leadingColumnWidth = 0,
    renderLeadingCell,
    renderLeadingHeader,
}: VirtualTableProps<RecordType>) => {
    const bodyRef = useRef<HTMLDivElement | null>(null)
    const headerScrollRef = useRef<HTMLDivElement | null>(null)

    const tanstackColumns = useMemo(() => toTanstackColumns(columns), [columns])

    const table = useReactTable<RecordType>({
        data: dataSource,
        columns: tanstackColumns,
        getCoreRowModel: getCoreRowModel(),
        getRowId: (record, index) => String(rowKey(record, index)),
        columnResizeMode: "onChange",
        state: {
            ...(columnVisibility ? {columnVisibility} : {}),
            ...(columnSizing ? {columnSizing} : {}),
            ...(rowSelection ? {rowSelection} : {}),
        },
        onColumnVisibilityChange,
        onColumnSizingChange,
        onRowSelectionChange,
        enableRowSelection: Boolean(onRowSelectionChange),
    })

    const rows = table.getRowModel().rows
    const leafColumns = table.getVisibleLeafColumns()

    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => bodyRef.current,
        estimateSize: () => rowHeight,
        overscan,
    })

    const virtualRows = virtualizer.getVirtualItems()
    const totalWidth = leafColumns.reduce(
        (sum, column) => sum + column.getSize(),
        leadingColumnWidth,
    )

    /** Pinned columns stack: each one starts where the previous pinned column ended. */
    const stickyOffsets = useMemo(() => {
        const left = new Map<string, number>()
        const right = new Map<string, number>()

        let runningLeft = leadingColumnWidth
        leafColumns.forEach((column) => {
            const fixed = sourceOf<RecordType>(column.columnDef.meta)?.fixed
            if (fixed === "left" || fixed === true) {
                left.set(column.id, runningLeft)
                runningLeft += column.getSize()
            }
        })

        let runningRight = 0
        for (let i = leafColumns.length - 1; i >= 0; i -= 1) {
            const column = leafColumns[i]
            if (sourceOf<RecordType>(column.columnDef.meta)?.fixed === "right") {
                right.set(column.id, runningRight)
                runningRight += column.getSize()
            }
        }

        return {left, right}
    }, [leafColumns, leadingColumnWidth])

    const stickyStyle = useCallback(
        (columnId: string): CSSProperties | undefined => {
            const left = stickyOffsets.left.get(columnId)
            if (left !== undefined) return {position: "sticky", left, zIndex: 2}
            const right = stickyOffsets.right.get(columnId)
            if (right !== undefined) return {position: "sticky", right, zIndex: 2}
            return undefined
        },
        [stickyOffsets],
    )

    // RAF-throttled bottom detection; a no-op loadMore keeps the hook order stable.
    const noopLoadMore = useCallback(() => undefined, [])
    const handleInfiniteScroll = useInfiniteScroll({
        loadMore: loadMore ?? noopLoadMore,
        scrollThreshold,
    })

    // The header is a separate table, so it has to track the body's horizontal scroll.
    const handleScroll = useCallback(
        (event: UIEvent<HTMLDivElement>) => {
            if (headerScrollRef.current) {
                headerScrollRef.current.scrollLeft = event.currentTarget.scrollLeft
            }
            if (loadMore) handleInfiniteScroll(event)
            onScroll?.(event)
        },
        [onScroll, loadMore, handleInfiniteScroll],
    )

    const colGroup = (
        <colgroup>
            {leadingColumnWidth ? (
                <col className={AVT.selectionCol} style={{width: leadingColumnWidth}} />
            ) : null}
            {leafColumns.map((column) => (
                <col key={column.id} style={{width: column.getSize()}} />
            ))}
        </colgroup>
    )

    const headerGroups = table.getHeaderGroups()

    return (
        <div className={cn(AVT.container, "flex min-h-0 flex-col overflow-hidden", className)}>
            <div ref={headerScrollRef} className="overflow-hidden">
                <table className="w-full table-fixed border-collapse" style={{width: totalWidth}}>
                    {colGroup}
                    <thead className={AVT.header}>
                        {headerGroups.map((headerGroup, groupIndex) => (
                            <tr key={headerGroup.id}>
                                {leadingColumnWidth && groupIndex === 0 ? (
                                    <th
                                        rowSpan={headerGroups.length}
                                        className={cn(
                                            AVT.headerCell,
                                            "box-border border-0 border-b border-solid border-colorBorderSecondary bg-colorBgContainer px-2 py-2 text-left",
                                        )}
                                        style={{position: "sticky", left: 0, zIndex: 3}}
                                    >
                                        {renderLeadingHeader?.()}
                                    </th>
                                ) : null}
                                {headerGroup.headers.map((header) => {
                                    const source = sourceOf<RecordType>(
                                        header.column.columnDef.meta,
                                    )
                                    const props =
                                        source && source.onHeaderCell
                                            ? (source.onHeaderCell(source, header.index) ?? {})
                                            : {}
                                    return (
                                        <th
                                            {...props}
                                            key={header.id}
                                            colSpan={header.colSpan}
                                            data-column-key={header.column.id}
                                            className={cn(
                                                AVT.headerCell,
                                                "box-border border-0 border-b border-solid border-colorBorderSecondary bg-colorBgContainer px-3 py-2 text-left text-field-md font-medium text-colorText",
                                                source?.ellipsis && "truncate",
                                                source?.className,
                                                props.className,
                                            )}
                                            style={{
                                                ...stickyStyle(header.column.id),
                                                textAlign: source?.align,
                                                ...props.style,
                                            }}
                                        >
                                            {header.isPlaceholder
                                                ? null
                                                : flexRender(
                                                      header.column.columnDef.header,
                                                      header.getContext(),
                                                  )}
                                        </th>
                                    )
                                })}
                            </tr>
                        ))}
                    </thead>
                </table>
            </div>

            <div
                ref={bodyRef}
                // flex-1 ONLY without an explicit height: `flex: 1 1 0%` makes the flex algorithm
                // compute the main size and ignore `height`, so the scroller grows to content and
                // the virtualizer sees an unbounded viewport — every row mounts.
                className={cn(AVT.body, "min-h-0 overflow-auto", height ? "shrink-0" : "flex-1")}
                style={height ? {height, flex: "none"} : undefined}
                onScroll={handleScroll}
            >
                {rows.length === 0 ? (
                    <div className="flex items-center justify-center py-10">{emptyText}</div>
                ) : (
                    <div style={{height: virtualizer.getTotalSize(), position: "relative"}}>
                        <table
                            className="absolute left-0 w-full table-fixed border-collapse"
                            style={{
                                width: totalWidth,
                                transform: `translateY(${virtualRows[0]?.start ?? 0}px)`,
                            }}
                        >
                            {colGroup}
                            <tbody>
                                {virtualRows.map((virtualRow) => {
                                    const row = rows[virtualRow.index]
                                    const record = row.original
                                    const rowProps = onRow?.(record, virtualRow.index) ?? {}
                                    return (
                                        <tr
                                            {...rowProps}
                                            key={row.id}
                                            data-index={virtualRow.index}
                                            ref={virtualizer.measureElement}
                                            className={cn(
                                                AVT.row,
                                                "border-0 border-b border-solid border-colorBorderSecondary hover:bg-colorFillTertiary",
                                                rowClassName?.(record, virtualRow.index),
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
                                                    {renderLeadingCell?.(record, virtualRow.index)}
                                                </td>
                                            ) : null}
                                            {row.getVisibleCells().map((cell) => {
                                                const source = sourceOf<RecordType>(
                                                    cell.column.columnDef.meta,
                                                )
                                                const props =
                                                    source?.onCell?.(record, virtualRow.index) ?? {}
                                                const rendered = source?.render
                                                    ? unpackRender(
                                                          source.render(
                                                              cell.getValue(),
                                                              record,
                                                              virtualRow.index,
                                                          ),
                                                      )
                                                    : {children: cell.getValue() as ReactNode}
                                                if (rendered.props?.colSpan === 0) return null
                                                return (
                                                    <td
                                                        {...props}
                                                        {...rendered.props}
                                                        key={cell.id}
                                                        className={cn(
                                                            AVT.cell,
                                                            "box-border bg-colorBgContainer px-3 align-top text-field-md text-colorText",
                                                            source?.ellipsis && "truncate",
                                                            source?.className,
                                                            props.className,
                                                        )}
                                                        style={{
                                                            ...stickyStyle(cell.column.id),
                                                            textAlign: source?.align,
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
