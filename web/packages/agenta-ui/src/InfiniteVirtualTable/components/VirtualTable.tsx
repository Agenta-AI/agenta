import type {CSSProperties, Key, ReactNode, UIEvent} from "react"
import {
    Fragment,
    isValidElement,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react"

import type {
    ColumnSizingState,
    OnChangeFn,
    RowSelectionState,
    ColumnVisibilityState,
    ExpandedState,
} from "@tanstack/react-table"
import {flexRender, useTable} from "@tanstack/react-table"
import {useVirtualizer} from "@tanstack/react-virtual"

import {Spinner} from "../../components/ui/spinner"
import {cn} from "../../utils/styles"
import type {ColumnDef, ColumnDefs, ColumnRenderResult, RenderedColumnCell} from "../columnDef"
import {isColumnGroupDef} from "../columnDef"
import {distributeColumnWidths, type DistributableColumn} from "../distributeColumnWidths"
import useInfiniteScroll from "../hooks/useInfiniteScroll"
import {AVT} from "../tableDom"
import {TABLE_FEATURES, type VirtualTableFeatures} from "../tableFeatures"
import {columnIdOf, sourceOf, toTanstackColumns} from "../tanstackColumns"

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

export interface VirtualTableHandle {
    scrollTo: (config: {index: number; align?: "top" | "bottom" | "auto"}) => void
}

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
    /**
     * Props spread onto the row's `<tr>`. Deliberately wide: the keyboard-shortcut hook
     * returns `onMouseEnter` and a `data-ivt-row-key` its document listeners search by, so
     * narrowing this to onClick/className would silently disable shortcuts.
     */
    onRow?: (
        record: RecordType,
        index: number,
    ) => React.HTMLAttributes<HTMLTableRowElement> & Record<string, unknown>
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
    /** Dims the body and shows a spinner, matching antd's `loading`. */
    loading?: boolean
    /** Inline styles for the table container, matching antd's `style`. */
    style?: CSSProperties
    /** Cell density, matching antd's Table sizes. */
    size?: "small" | "middle" | "large"
    /** Draws cell borders, matching antd's `bordered`. */
    bordered?: boolean
    /**
     * Imperative handle for programmatic scrolling, matching InfiniteVirtualTable's `tableRef`.
     */
    tableRef?: React.RefObject<VirtualTableHandle | null>
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
    /** Props for the leading cell's <td>, so a caller's rowSelection.onCell survives. */
    leadingCellProps?: (
        record: RecordType,
        index: number,
    ) => React.TdHTMLAttributes<HTMLTableCellElement>
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

/**
 * antd's density steps. Measured against a real antd virtual table: it renders its default,
 * "small" and "large" at the same height and only "middle" differs, so an unsized table
 * defaults to that shared density rather than to the middle of the three.
 */
const CELL_PADDING = {
    small: "px-2 py-2",
    middle: "px-2 py-3",
    // Not a typo: antd's VIRTUAL table renders "large" at the same height as its default and
    // as "small" (measured: 37px for all three, 45px only for "middle"). Matching that keeps
    // the engine swap invisible, which matters more than a tidier-looking scale.
    large: "px-4 py-2",
} as const

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

    return leaves.map((column, index) => {
        const width =
            typeof column.width === "number"
                ? column.width
                : typeof column.minWidth === "number"
                  ? column.minWidth
                  : AUTO_LAYOUT_DEFAULT_WIDTH
        // maxWidth is not on ColumnDef; callers pass it through, as they did before.
        const declaredMax = (column as {maxWidth?: number}).maxWidth
        return {
            // Must match toTanstackColumns exactly, or these widths key nothing.
            key: columnIdOf(column, index),
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
    loading = false,
    style,
    size = "small",
    bordered = false,
    tableRef,
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
    leadingCellProps,
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

    // Drags have to survive auto-layout: they are its INPUT, not something it overwrites.
    // When sizing is uncontrolled we keep our own copy, else a drag would be recomputed away
    // on the very next render and the column would snap back.
    const [internalSizing, setInternalSizing] = useState<ColumnSizingState>({})
    const userWidths = columnSizing ?? internalSizing

    const handleColumnSizingChange = useCallback<OnChangeFn<ColumnSizingState>>(
        (updater) => {
            setInternalSizing((prev) => (typeof updater === "function" ? updater(prev) : updater))
            onColumnSizingChange?.(updater)
        },
        [onColumnSizingChange],
    )

    const effectiveSizing = useMemo(() => {
        if (!autoLayout || containerWidth === 0) return userWidths
        return distributeColumnWidths({
            columns: toDistributable(columns),
            containerWidth,
            userWidths,
            leadingColumnWidth,
        })
    }, [autoLayout, containerWidth, columns, userWidths, leadingColumnWidth])

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
        onColumnSizingChange: handleColumnSizingChange,
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

    // antd's align vocabulary differs from the virtualizer's.
    const VIRTUAL_ALIGN = {top: "start", bottom: "end", auto: "auto"} as const

    useImperativeHandle(
        tableRef,
        () => ({
            scrollTo: ({index, align = "auto"}) =>
                virtualizer.scrollToIndex(index, {align: VIRTUAL_ALIGN[align]}),
        }),
        [virtualizer],
    )

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

    // Header cells must be OPAQUE. `colorFillQuaternary` is a 4%-white WASH, so a sticky header
    // cell (the pinned Name column, the settings column pinned right) let the columns scrolling
    // underneath show straight through it — "Name" and "Inputs" rendered on top of each other.
    // Same tone, painted as a gradient layer over an opaque base instead of as a translucent fill.
    const headerCellPaint: CSSProperties = {
        backgroundColor: "var(--ag-colorBgContainer)",
        backgroundImage:
            "linear-gradient(var(--ag-colorFillQuaternary), var(--ag-colorFillQuaternary))",
    }

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
            className={cn(
                AVT.container,
                "relative flex min-h-0 flex-col overflow-hidden",
                // antd's `bordered` boxes the WHOLE table, not just the cells. Only the inner
                // rules were ported, so the table had no outer edge at all.
                bordered && "border border-solid border-colorBorderSecondary",
                className,
            )}
            style={style}
        >
            {loading ? (
                <div
                    data-table-loading
                    className="absolute inset-0 z-10 flex items-center justify-center bg-colorBgContainer/60"
                >
                    <Spinner />
                </div>
            ) : null}
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
                                            "box-border border-0 border-b border-solid border-colorBorderSecondary px-2 py-2 text-left",
                                            // The selection and expand columns are columns too:
                                            // without this the row-select column ran straight
                                            // into Name with no rule between them.
                                            bordered && "border-r",
                                        )}
                                        style={{
                                            ...headerCellPaint,
                                            position: "sticky",
                                            left: 0,
                                            zIndex: 3,
                                        }}
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
                                            "box-border border-0 border-b border-solid border-colorBorderSecondary px-2 py-2",
                                            bordered && "border-r",
                                        )}
                                        style={{
                                            ...headerCellPaint,
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
                                                "relative box-border border-0 border-b border-solid border-colorBorderSecondary text-left text-field-md font-medium text-colorText",
                                                CELL_PADDING[size],
                                                bordered && "border-r",
                                                source?.ellipsis && "truncate",
                                                source?.className,
                                                props.className,
                                            )}
                                            style={{
                                                ...headerCellPaint,
                                                ...stickyStyle(header.column.id),
                                                textAlign: source?.align,
                                                ...props.style,
                                            }}
                                        >
                                            {/* flexRender returns an UNKEYED element, and these
                                                siblings form a child array React validates, so
                                                the wrapper carries the key. */}
                                            {header.isPlaceholder ? null : (
                                                <Fragment key="content">
                                                    {flexRender(
                                                        header.column.columnDef.header,
                                                        header.getContext(),
                                                    )}
                                                </Fragment>
                                            )}
                                            {enableColumnResizing &&
                                            header.column.getCanResize() ? (
                                                <span
                                                    key="resize"
                                                    role="separator"
                                                    aria-orientation="vertical"
                                                    aria-label={`Resize ${header.column.id}`}
                                                    data-resize-handle={header.column.id}
                                                    className={cn(
                                                        AVT.resizeHandle,
                                                        // 4px was effectively ungrabbable. 8px of
                                                        // hit area inside the cell, with a 1px
                                                        // indicator drawn on the edge itself.
                                                        "absolute right-0 top-0 z-[1] h-full w-2 cursor-col-resize touch-none select-none",
                                                        "after:absolute after:inset-y-0 after:right-0 after:w-px after:content-['']",
                                                        "hover:after:bg-colorPrimary",
                                                        header.column.getIsResizing() &&
                                                            "after:bg-colorPrimary",
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
                                            // antd stamps this and our own hooks query by it
                                            // (keyboard shortcuts find rows via [data-row-key]).
                                            data-row-key={row.id}
                                            className={cn(
                                                AVT.row,
                                                "border-0 border-b border-solid border-colorBorderSecondary hover:bg-colorFillTertiary",
                                                rowClassName?.(record, virtualRow.index),
                                                rowProps.className,
                                            )}
                                        >
                                            {leadingColumnWidth ? (
                                                <td
                                                    {...leadingCellProps?.(
                                                        record,
                                                        virtualRow.index,
                                                    )}
                                                    key="leading"
                                                    className={cn(
                                                        AVT.cell,
                                                        "box-border bg-colorBgContainer px-2 align-middle",
                                                        bordered &&
                                                            "border-0 border-r border-solid border-colorBorderSecondary",
                                                        leadingCellProps?.(record, virtualRow.index)
                                                            ?.className,
                                                    )}
                                                    style={{
                                                        position: "sticky",
                                                        left: 0,
                                                        // ABOVE the pinned data columns (z 2), the
                                                        // same order the header uses. Inverted, the
                                                        // leading cell sat UNDER the column pinned
                                                        // beside it, so their shared edge showed
                                                        // the scrolling content through it.
                                                        zIndex: 3,
                                                        ...leadingCellProps?.(
                                                            record,
                                                            virtualRow.index,
                                                        )?.style,
                                                    }}
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
                                                        bordered &&
                                                            "border-0 border-r border-solid border-colorBorderSecondary",
                                                    )}
                                                    style={{
                                                        position: "sticky",
                                                        left: leadingColumnWidth,
                                                        zIndex: 3,
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
                                                            "box-border bg-colorBgContainer align-top text-field-md text-colorText",
                                                            CELL_PADDING[size],
                                                            bordered &&
                                                                "border-0 border-r border-solid border-colorBorderSecondary",
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
