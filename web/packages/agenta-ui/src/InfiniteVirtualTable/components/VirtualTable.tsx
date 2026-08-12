import type {CSSProperties, Key, ReactNode, UIEvent} from "react"
import {isValidElement, useCallback, useEffect, useMemo, useRef, useState} from "react"

import type {
    ColumnSizingState,
    OnChangeFn,
    RowSelectionState,
    ColumnVisibilityState,
    ExpandedState,
} from "@tanstack/react-table"
import {flexRender, useTable} from "@tanstack/react-table"
import {useVirtualizer} from "@tanstack/react-virtual"

import {cn} from "../../utils/styles"
import type {ColumnDef, ColumnDefs, ColumnRenderResult, RenderedColumnCell} from "../columnDef"
import {isColumnGroupDef} from "../columnDef"
import {distributeColumnWidths, type DistributableColumn} from "../distributeColumnWidths"
import useInfiniteScroll from "../hooks/useInfiniteScroll"
import {AVT} from "../tableDom"
import {TABLE_FEATURES, type VirtualTableFeatures} from "../tableFeatures"
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
    columnVisibility?: ColumnVisibilityState
    onColumnVisibilityChange?: OnChangeFn<ColumnVisibilityState>
    /** Controlled column widths, keyed by column id. */
    columnSizing?: ColumnSizingState
    onColumnSizingChange?: OnChangeFn<ColumnSizingState>
    /** Controlled row selection, keyed by row id. */
    rowSelection?: RowSelectionState
    onRowSelectionChange?: OnChangeFn<RowSelectionState>
    /**
     * Renders a full-width panel under an expanded row. Passing it turns on the expand column.
     * Async children (fetch, loading, error) stay the caller's job; the table owns open/closed.
     */
    renderExpandedRow?: (record: RecordType, index: number) => ReactNode
    /** Controlled expanded state, keyed by row id. */
    expanded?: ExpandedState
    onExpandedChange?: OnChangeFn<ExpandedState>
    /** Rows this returns false for get no chevron. */
    getRowCanExpand?: (record: RecordType) => boolean
    expandColumnWidth?: number
    /**
     * Shares the container width across columns instead of using declared widths as-is.
     * With it on, `columnSizing` carries the user's drags and the rest is filled in.
     */
    autoLayout?: boolean
    /** Draws a drag handle on every resizable header cell. */
    enableColumnResizing?: boolean
    /** "onChange" resizes live while dragging; "onEnd" commits once on release. */
    columnResizeMode?: "onChange" | "onEnd"
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

/** Defaults carried over from the hook this replaces; changing them moves every layout. */
const AUTO_LAYOUT_DEFAULT_WIDTH = 200
const AUTO_LAYOUT_DEFAULT_MIN_WIDTH = 150

const toDistributable = <RecordType,>(columns: ColumnDefs<RecordType>): DistributableColumn[] => {
    const leaves: ColumnDef<RecordType>[] = []
    const visit = (entries: ColumnDefs<RecordType>) => {
        entries.forEach((entry) => {
            if (isColumnGroupDef(entry)) visit(entry.children)
            else leaves.push(entry as ColumnDef<RecordType>)
        })
    }
    visit(columns)

    return leaves.map((column) => {
        const width =
            typeof column.width === "number"
                ? column.width
                : typeof column.minWidth === "number"
                  ? column.minWidth
                  : AUTO_LAYOUT_DEFAULT_WIDTH
        // maxWidth is not on ColumnDef; callers pass it through, as they did before.
        const declaredMax = (column as {maxWidth?: number}).maxWidth
        return {
            key: String(column.key ?? column.dataIndex ?? ""),
            width,
            // A column narrower than the default floor keeps its own smaller floor, else the
            // floor would exceed the width it asked for and it could never be dragged down.
            minWidth:
                typeof column.minWidth === "number"
                    ? column.minWidth
                    : Math.min(AUTO_LAYOUT_DEFAULT_MIN_WIDTH, width),
            maxWidth: typeof declaredMax === "number" && declaredMax > 0 ? declaredMax : undefined,
            isFixed: Boolean(column.fixed),
        }
    })
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
    renderExpandedRow,
    expanded,
    onExpandedChange,
    getRowCanExpand,
    expandColumnWidth = 48,
    autoLayout = false,
    enableColumnResizing = false,
    columnResizeMode = "onChange",
    leadingColumnWidth = 0,
    renderLeadingCell,
    renderLeadingHeader,
}: VirtualTableProps<RecordType>) => {
    const bodyRef = useRef<HTMLDivElement | null>(null)
    const headerScrollRef = useRef<HTMLDivElement | null>(null)
    const containerRef = useRef<HTMLDivElement | null>(null)
    const [containerWidth, setContainerWidth] = useState(0)

    // Auto-layout needs the live container width, so it has to be measured rather than passed.
    useEffect(() => {
        if (!autoLayout) return
        const node = containerRef.current
        if (!node) return
        const observer = new ResizeObserver(([entry]) => {
            setContainerWidth(entry.contentRect.width)
        })
        observer.observe(node)
        setContainerWidth(node.getBoundingClientRect().width)
        return () => observer.disconnect()
    }, [autoLayout])

    const tanstackColumns = useMemo(() => toTanstackColumns(columns), [columns])

    // The user's drags are the input to the distribution, not the final widths.
    const effectiveSizing = useMemo(() => {
        if (!autoLayout || containerWidth === 0) return columnSizing
        return distributeColumnWidths({
            columns: toDistributable(columns),
            containerWidth,
            userWidths: columnSizing,
            leadingColumnWidth,
        })
    }, [autoLayout, containerWidth, columns, columnSizing, leadingColumnWidth])

    const table = useTable<VirtualTableFeatures, RecordType>({
        features: TABLE_FEATURES,
        data: dataSource,
        columns: tanstackColumns,
        getRowId: (record, index) => String(rowKey(record, index)),
        columnResizeMode,
        enableColumnResizing,
        state: {
            ...(columnVisibility ? {columnVisibility} : {}),
            ...(effectiveSizing ? {columnSizing: effectiveSizing} : {}),
            ...(rowSelection ? {rowSelection} : {}),
            ...(expanded !== undefined ? {expanded} : {}),
        },
        onColumnVisibilityChange,
        onColumnSizingChange,
        onRowSelectionChange,
        enableRowSelection: Boolean(onRowSelectionChange),
        onExpandedChange,
        enableExpanding: Boolean(renderExpandedRow),
        getRowCanExpand: (row) => (getRowCanExpand ? getRowCanExpand(row.original) : true),
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
    const expandWidth = renderExpandedRow ? expandColumnWidth : 0
    const totalWidth = leafColumns.reduce(
        (sum, column) => sum + column.getSize(),
        leadingColumnWidth + expandWidth,
    )

    /** Pinned columns stack: each one starts where the previous pinned column ended. */
    const stickyOffsets = useMemo(() => {
        const left = new Map<string, number>()
        const right = new Map<string, number>()

        let runningLeft = leadingColumnWidth + expandWidth
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
    }, [leafColumns, leadingColumnWidth, expandWidth])

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
                <col
                    key="leading"
                    className={AVT.selectionCol}
                    style={{width: leadingColumnWidth}}
                />
            ) : null}
            {expandWidth ? <col key="expand" style={{width: expandWidth}} /> : null}
            {leafColumns.map((column) => (
                <col key={column.id} style={{width: column.getSize()}} />
            ))}
        </colgroup>
    )

    const headerGroups = table.getHeaderGroups()

    return (
        <div
            ref={containerRef}
            className={cn(AVT.container, "flex min-h-0 flex-col overflow-hidden", className)}
        >
            <div ref={headerScrollRef} className="overflow-hidden">
                <table className="w-full table-fixed border-collapse" style={{width: totalWidth}}>
                    {colGroup}
                    <thead className={AVT.header}>
                        {headerGroups.map((headerGroup, groupIndex) => (
                            <tr key={headerGroup.id}>
                                {leadingColumnWidth && groupIndex === 0 ? (
                                    <th
                                        key="leading"
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
                                {expandWidth && groupIndex === 0 ? (
                                    <th
                                        key="expand"
                                        rowSpan={headerGroups.length}
                                        className={cn(
                                            AVT.headerCell,
                                            "box-border border-0 border-b border-solid border-colorBorderSecondary bg-colorBgContainer px-2 py-2",
                                        )}
                                        style={{
                                            position: "sticky",
                                            left: leadingColumnWidth,
                                            zIndex: 3,
                                        }}
                                    />
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
                                                "relative box-border border-0 border-b border-solid border-colorBorderSecondary bg-colorBgContainer px-3 py-2 text-left text-field-md font-medium text-colorText",
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
                                            {enableColumnResizing &&
                                            header.column.getCanResize() ? (
                                                <span
                                                    role="separator"
                                                    aria-orientation="vertical"
                                                    aria-label={`Resize ${header.column.id}`}
                                                    data-resize-handle={header.column.id}
                                                    className={cn(
                                                        AVT.resizeHandle,
                                                        "absolute right-0 top-0 h-full w-1 cursor-col-resize touch-none select-none",
                                                        "hover:bg-colorPrimary",
                                                        header.column.getIsResizing() &&
                                                            "bg-colorPrimary",
                                                    )}
                                                    onMouseDown={header.getResizeHandler()}
                                                    onTouchStart={header.getResizeHandler()}
                                                    // The handle sits inside the header button/label; a click here
                                                    // must not read as a sort/menu click on the header itself.
                                                    onClick={(event) => event.stopPropagation()}
                                                />
                                            ) : null}
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
                            {virtualRows.map((virtualRow) => {
                                const row = rows[virtualRow.index]
                                const record = row.original
                                const rowProps = onRow?.(record, virtualRow.index) ?? {}
                                const expanded = Boolean(renderExpandedRow) && row.getIsExpanded()
                                return (
                                    // One tbody per virtual item: the expanded panel is a second
                                    // <tr>, and the virtualizer must measure BOTH, not just the row.
                                    <tbody
                                        key={row.id}
                                        data-index={virtualRow.index}
                                        ref={virtualizer.measureElement}
                                    >
                                        <tr
                                            {...rowProps}
                                            className={cn(
                                                AVT.row,
                                                "border-0 border-b border-solid border-colorBorderSecondary hover:bg-colorFillTertiary",
                                                rowClassName?.(record, virtualRow.index),
                                                rowProps.className,
                                            )}
                                        >
                                            {leadingColumnWidth ? (
                                                <td
                                                    key="leading"
                                                    className={cn(
                                                        AVT.cell,
                                                        "box-border bg-colorBgContainer px-2 align-middle",
                                                    )}
                                                    style={{position: "sticky", left: 0, zIndex: 1}}
                                                >
                                                    {renderLeadingCell?.(record, virtualRow.index)}
                                                </td>
                                            ) : null}
                                            {expandWidth ? (
                                                <td
                                                    key="expand"
                                                    className={cn(
                                                        AVT.cell,
                                                        AVT.expandCell,
                                                        "box-border bg-colorBgContainer px-2 align-middle",
                                                    )}
                                                    style={{
                                                        position: "sticky",
                                                        left: leadingColumnWidth,
                                                        zIndex: 1,
                                                    }}
                                                >
                                                    {row.getCanExpand() ? (
                                                        <button
                                                            type="button"
                                                            aria-label={
                                                                expanded
                                                                    ? "Collapse row"
                                                                    : "Expand row"
                                                            }
                                                            aria-expanded={expanded}
                                                            data-expand-toggle={row.id}
                                                            className="flex size-6 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-colorTextSecondary"
                                                            onClick={(event) => {
                                                                // The row itself may navigate; expanding must not.
                                                                event.stopPropagation()
                                                                row.toggleExpanded()
                                                            }}
                                                        >
                                                            <span
                                                                className={cn(
                                                                    "transition-transform",
                                                                    expanded && "rotate-90",
                                                                )}
                                                            >
                                                                ›
                                                            </span>
                                                        </button>
                                                    ) : null}
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
                                        {expanded ? (
                                            <tr className={AVT.expandedRow}>
                                                <td
                                                    colSpan={
                                                        leafColumns.length +
                                                        (leadingColumnWidth ? 1 : 0) +
                                                        (renderExpandedRow ? 1 : 0)
                                                    }
                                                    className="box-border border-0 border-b border-solid border-colorBorderSecondary bg-colorBgContainer p-0"
                                                >
                                                    {renderExpandedRow?.(record, virtualRow.index)}
                                                </td>
                                            </tr>
                                        ) : null}
                                    </tbody>
                                )
                            })}
                        </table>
                    </div>
                )}
            </div>
        </div>
    )
}

export default VirtualTable
