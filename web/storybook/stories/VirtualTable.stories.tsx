import type {Key} from "react"
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    InfiniteVirtualTable,
    VirtualTable,
    useVirtualTableRowSelection,
    type ColumnDefs,
    type VirtualTableHandle,
} from "@agenta/ui/table"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Table as AntTable} from "antd"

/**
 * VirtualTable — the antd-free render leaf that replaces `<Table virtual>`.
 *
 * The app it was built for has three rows of data, so every behaviour that only shows up at
 * scale or in a corner (windowing, pinned columns, merged cells, selection) is exercised here
 * instead. The antd story renders the SAME columns through `<Table virtual>` for a like-for-like
 * comparison.
 *
 * Stories that need state are components, not `render` arrows: hooks in a story arrow break
 * rules-of-hooks.
 */
const meta = {
    title: "@agenta/ui/Table/VirtualTable",
    component: VirtualTable,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Plain table DOM plus row windowing. Replaces antd `<Table virtual>` so `/m` — which replaces web/oss and web/ee — can render the real table without antd in the bundle.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

interface Row {
    key: string
    id: string
    name: string
    kind: string
    duration: string
    cost: string
    note: string
}

const makeRows = (count: number, offset = 0): Row[] =>
    Array.from({length: count}, (_, index) => index + offset).map((i) => ({
        key: `row-${i}`,
        id: `span-${String(i).padStart(5, "0")}`,
        name: i % 7 === 0 ? `a much longer span name that should truncate — ${i}` : `span ${i}`,
        kind: ["workflow", "llm", "tool", "chain"][i % 4],
        duration: `${(i % 90) + 10}ms`,
        cost: i % 3 === 0 ? "—" : `$${((i % 50) / 1000).toFixed(4)}`,
        note: `row ${i} note`,
    }))

const baseColumns: ColumnDefs<Row> = [
    {key: "id", title: "ID", dataIndex: "id", width: 200},
    {key: "name", title: "Name", dataIndex: "name", width: 320, ellipsis: true},
    {key: "kind", title: "Span type", dataIndex: "kind", width: 140},
    {key: "duration", title: "Duration", dataIndex: "duration", width: 120, align: "right"},
    {key: "cost", title: "Cost", dataIndex: "cost", width: 120, align: "right"},
    {key: "note", title: "Note", dataIndex: "note", width: 260},
]

const Frame = ({children}: {children: React.ReactNode}) => (
    <div className="h-[420px] w-full border border-solid border-colorBorderSecondary">
        {children}
    </div>
)

const Note = ({children}: {children: React.ReactNode}) => (
    <p className="m-0 text-xs text-colorTextSecondary">{children}</p>
)

/** The ordinary case: a handful of rows, every column visible. */
export const Basic: Story = {
    render: () => (
        <Frame>
            <VirtualTable<Row>
                columns={baseColumns}
                dataSource={makeRows(12)}
                rowKey={(row) => row.key}
                rowHeight={48}
                height={420}
            />
        </Frame>
    ),
}

/**
 * 10,000 rows. Only the visible slice plus overscan should be in the DOM — if the mounted row
 * count tracks the viewport rather than the dataset, windowing works.
 */
const WindowingDemo = () => {
    const rows = useMemo(() => makeRows(10_000), [])
    return (
        <div className="flex flex-col gap-2">
            <Note>10,000 rows. Mounted rows should stay ~20 at any scroll position.</Note>
            <Frame>
                <VirtualTable<Row>
                    columns={baseColumns}
                    dataSource={rows}
                    rowKey={(row) => row.key}
                    rowHeight={48}
                    height={420}
                />
            </Frame>
        </div>
    )
}

export const Windowing: Story = {render: () => <WindowingDemo />}

/**
 * Infinite loading. `loadMore` fires when the body scrolls within `scrollThreshold` px of the
 * bottom, RAF-throttled so it costs nothing during a fast flick. This is what the observability
 * traces list runs on: a page arrives, rows append, the next page loads as you keep scrolling.
 */
const InfiniteLoadingDemo = () => {
    const PAGE = 25
    const [rows, setRows] = useState(() => makeRows(PAGE))
    const [pages, setPages] = useState(1)
    const loading = useRef(false)

    const loadMore = () => {
        if (loading.current || rows.length >= 200) return
        loading.current = true
        // A real fetch is async; the timeout stands in for it and proves we don't re-enter.
        setTimeout(() => {
            setRows((prev) => [...prev, ...makeRows(PAGE, prev.length)])
            setPages((p) => p + 1)
            loading.current = false
        }, 300)
    }

    return (
        <div className="flex flex-col gap-2">
            <Note>
                Scroll to the bottom: pages append until 200 rows. Loaded {rows.length} rows over{" "}
                {pages} page{pages === 1 ? "" : "s"}.
            </Note>
            <Frame>
                <VirtualTable<Row>
                    columns={baseColumns}
                    dataSource={rows}
                    rowKey={(row) => row.key}
                    rowHeight={48}
                    height={420}
                    loadMore={loadMore}
                    scrollThreshold={300}
                />
            </Frame>
        </div>
    )
}

export const InfiniteLoading: Story = {render: () => <InfiniteLoadingDemo />}

/**
 * The antd-shaped `rowSelection` prop, driven through `useVirtualTableRowSelection`.
 *
 * This is the shape ~80 existing call sites already pass. The adapter turns it into the
 * `RowSelectionState` + leading-cell props VirtualTable speaks, so those call sites move
 * over without edits. Every branch is exercised here: select-all, the indeterminate
 * header, `getCheckboxProps` disabling rows, and `selectOnRowClick`.
 */
const SelectionAdapterDemo = () => {
    const rows = useMemo(() => makeRows(30), [])
    const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([])
    const [lastRows, setLastRows] = useState(0)
    const rowKeyFn = useCallback((row: Row) => row.key, [])

    // Every 5th row is locked: it must never enter the set, not even via select-all.
    const getCheckboxProps = useCallback(
        (row: Row) => ({disabled: Number(row.key.split("-")[1]) % 5 === 0}),
        [],
    )

    const selection = useVirtualTableRowSelection<Row>({
        rowSelection: {
            selectedRowKeys,
            getCheckboxProps,
            selectOnRowClick: true,
            onChange: (keys, records) => {
                setSelectedRowKeys(keys)
                setLastRows(records.length)
            },
        },
        dataSource: rows,
        rowKey: rowKeyFn,
    })

    return (
        <div className="flex flex-col gap-2">
            <Note>
                Selected {selectedRowKeys.length} (onChange handed back {lastRows} records). Every
                5th row is disabled and must stay unselected, including after Select all. Clicking a
                row toggles it.
            </Note>
            <Frame>
                <VirtualTable<Row>
                    columns={baseColumns}
                    dataSource={rows}
                    rowKey={rowKeyFn}
                    rowHeight={48}
                    height={420}
                    {...selection}
                    onRow={(record, index) => ({
                        onClick: () => selection?.onRowClickSelect?.(record, index),
                    })}
                />
            </Frame>
        </div>
    )
}

export const SelectionAdapter: Story = {render: () => <SelectionAdapterDemo />}

/** `type: "radio"` keeps exactly one row selected and drops the select-all header. */
const SelectionRadioDemo = () => {
    const rows = useMemo(() => makeRows(20), [])
    const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([])
    const rowKeyFn = useCallback((row: Row) => row.key, [])

    const selection = useVirtualTableRowSelection<Row>({
        rowSelection: {type: "radio", selectedRowKeys, onChange: setSelectedRowKeys},
        dataSource: rows,
        rowKey: rowKeyFn,
    })

    return (
        <div className="flex flex-col gap-2">
            <Note>
                Radio: selecting a second row replaces the first. Selected:{" "}
                {selectedRowKeys.length === 0 ? "none" : String(selectedRowKeys[0])}
            </Note>
            <Frame>
                <VirtualTable<Row>
                    columns={baseColumns}
                    dataSource={rows}
                    rowKey={rowKeyFn}
                    rowHeight={48}
                    height={420}
                    {...selection}
                />
            </Frame>
        </div>
    )
}

export const SelectionRadio: Story = {render: () => <SelectionRadioDemo />}

/**
 * Column resizing, on TanStack's `columnResizingFeature`.
 *
 * The handle is a plain span wired to `header.getResizeHandler()` — no `react-resizable`, no
 * antd. Widths live in `columnSizing`, so the host owns them and can persist them; TanStack
 * clamps to each column's `minSize`, which comes from the column's `minWidth`.
 */
const ResizableDemo = () => {
    const rows = useMemo(() => makeRows(20), [])
    const [columnSizing, setColumnSizing] = useState<Record<string, number>>({})
    const sizes = Object.entries(columnSizing)

    return (
        <div className="flex flex-col gap-2">
            <Note>
                Drag any header edge. Sizes:{" "}
                {sizes.length === 0
                    ? "none yet (all at declared width)"
                    : sizes.map(([id, w]) => `${id}=${Math.round(w)}`).join(", ")}
            </Note>
            <Frame>
                <VirtualTable<Row>
                    columns={baseColumns}
                    dataSource={rows}
                    rowKey={(row) => row.key}
                    rowHeight={48}
                    height={420}
                    enableColumnResizing
                    columnSizing={columnSizing}
                    onColumnSizingChange={setColumnSizing}
                />
            </Frame>
        </div>
    )
}

export const Resizable: Story = {render: () => <ResizableDemo />}

/**
 * Auto-layout: the container's width shared across columns.
 *
 * TanStack has no notion of filling available space, so this is the one piece of the old
 * `useSmartResizableColumns` that was ported rather than deleted. Its rules are pinned by
 * unit tests; this story is where you can see them.
 *
 * The invariant: the total is never LESS than the container. When space runs short the table
 * overflows and scrolls sideways instead of squeezing columns below their declared width.
 */
const autoLayoutColumns: ColumnDefs<Row> = [
    {key: "id", title: "ID (fixed 120)", dataIndex: "id", width: 120, fixed: "left"},
    {key: "name", title: "Name (weight 300)", dataIndex: "name", width: 300, ellipsis: true},
    {key: "kind", title: "Span type (weight 100)", dataIndex: "kind", width: 100},
    // maxWidth is not on ColumnDef; auto-layout reads it off the column as the old hook did.
    {
        key: "cost",
        title: "Cost (capped 140)",
        dataIndex: "cost",
        width: 100,
        maxWidth: 140,
    } as never,
]

const AutoLayoutDemo = () => {
    const [width, setWidth] = useState(900)
    const rows = useMemo(() => makeRows(15), [])

    return (
        <div className="flex flex-col gap-2">
            <Note>
                Container {width}px. ID is pinned at 120 and Cost capped at 140; Name and Span type
                share what is left, 300:100. Drag the slider below 560 and the columns stop
                shrinking — the table scrolls instead.
            </Note>
            <input
                type="range"
                min={320}
                max={1200}
                value={width}
                onChange={(event) => setWidth(Number(event.target.value))}
                className="w-full"
                aria-label="Container width"
            />
            <div
                style={{width}}
                className="h-[420px] border border-solid border-colorBorderSecondary"
            >
                <VirtualTable<Row>
                    columns={autoLayoutColumns}
                    dataSource={rows}
                    rowKey={(row) => row.key}
                    rowHeight={48}
                    height={420}
                    autoLayout
                />
            </div>
        </div>
    )
}

export const AutoLayout: Story = {render: () => <AutoLayoutDemo />}

/**
 * Expandable rows, with async children.
 *
 * TanStack owns which rows are open; fetching the children stays the caller's job, which is
 * what the existing `ExpandableRowConfig` does. Each virtual item is its own `<tbody>` so the
 * virtualizer measures the row AND its panel — measure only the row and every position below
 * an open row is wrong by the panel's height.
 */
const ExpandableDemo = () => {
    const rows = useMemo(() => makeRows(30), [])
    const [expanded, setExpanded] = useState<Record<string, boolean>>({})
    const [children, setChildren] = useState<Record<string, string[]>>({})

    // Stands in for a real fetch, so the panel has a loading state to show.
    useEffect(() => {
        // forEach discards what its callback returns, so these timers used to outlive the
        // effect; collect them and clear on cleanup instead.
        const timers = Object.keys(expanded)
            .filter((key) => expanded[key] && !children[key])
            .map((key) => {
                return setTimeout(() => {
                    setChildren((prev) => ({
                        ...prev,
                        [key]: [`${key} child A`, `${key} child B`, `${key} child C`],
                    }))
                }, 400)
            })

        return () => timers.forEach(clearTimeout)
    }, [expanded, children])

    const openCount = Object.values(expanded).filter(Boolean).length

    return (
        <div className="flex flex-col gap-2">
            <Note>
                {openCount} row{openCount === 1 ? "" : "s"} open. Every 4th row cannot expand.
                Panels load after 400ms; rows below must stay correctly positioned throughout.
            </Note>
            <Frame>
                <VirtualTable<Row>
                    columns={baseColumns}
                    dataSource={rows}
                    rowKey={(row) => row.key}
                    rowHeight={48}
                    height={420}
                    expanded={expanded}
                    onExpandedChange={(updater) =>
                        setExpanded((prev) =>
                            typeof updater === "function"
                                ? (updater(prev) as Record<string, boolean>)
                                : (updater as Record<string, boolean>),
                        )
                    }
                    getRowCanExpand={(row) => Number(row.key.split("-")[1]) % 4 !== 0}
                    renderExpandedRow={(row) => (
                        <div
                            className="bg-colorFillQuaternary px-4 py-3 text-xs"
                            data-panel={row.key}
                        >
                            {children[row.key] ? (
                                <ul className="m-0 flex flex-col gap-1 pl-4">
                                    {children[row.key].map((child) => (
                                        <li key={child}>{child}</li>
                                    ))}
                                </ul>
                            ) : (
                                <span className="text-colorTextSecondary">Loading children…</span>
                            )}
                        </div>
                    )}
                />
            </Frame>
        </div>
    )
}

export const Expandable: Story = {render: () => <ExpandableDemo />}

/** Left- and right-pinned columns must stay put and not overlap while scrolling sideways. */
const stickyColumns: ColumnDefs<Row> = [
    {...baseColumns[0], fixed: "left"},
    {...baseColumns[1], fixed: "left"},
    baseColumns[2],
    {key: "wide", title: "Wide filler", dataIndex: "note", width: 700},
    baseColumns[3],
    {...baseColumns[4], fixed: "right"},
]

export const StickyColumns: Story = {
    render: () => (
        <div className="flex flex-col gap-2">
            <Note>Scroll sideways: ID + Name pin left, Cost pins right, nothing overlaps.</Note>
            <Frame>
                <VirtualTable<Row>
                    columns={stickyColumns}
                    dataSource={makeRows(40)}
                    rowKey={(row) => row.key}
                    rowHeight={48}
                    height={420}
                />
            </Frame>
        </div>
    ),
}

/** The selection column is a leading cell the host renders; it must pin with the left edge. */
const RowSelectionDemo = () => {
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const rows = useMemo(() => makeRows(30), [])

    const toggle = (key: string) =>
        setSelected((prev) => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })

    const allSelected = selected.size === rows.length

    return (
        <div className="flex flex-col gap-2">
            <Note>
                Selected: {selected.size}. Checkbox column pins left and survives scrolling.
            </Note>
            <Frame>
                <VirtualTable<Row>
                    columns={baseColumns}
                    dataSource={rows}
                    rowKey={(row) => row.key}
                    rowHeight={48}
                    height={420}
                    leadingColumnWidth={48}
                    renderLeadingHeader={() => (
                        <input
                            type="checkbox"
                            aria-label="Select all"
                            checked={allSelected}
                            onChange={() =>
                                setSelected(
                                    allSelected ? new Set() : new Set(rows.map((r) => r.key)),
                                )
                            }
                        />
                    )}
                    renderLeadingCell={(row) => (
                        <input
                            type="checkbox"
                            aria-label={`Select ${row.id}`}
                            checked={selected.has(row.key)}
                            onChange={() => toggle(row.key)}
                        />
                    )}
                    rowClassName={(row) => (selected.has(row.key) ? "bg-colorPrimaryBg" : "")}
                />
            </Frame>
        </div>
    )
}

export const RowSelection: Story = {render: () => <RowSelectionDemo />}

/**
 * `render` returning antd's `{props, children}` cell-override shape. Coded and typed but never
 * exercised in the app: row 0 spans three columns, and colSpan 0 drops the covered cells.
 */
const mergedColumns: ColumnDefs<Row> = [
    baseColumns[0],
    {
        ...baseColumns[1],
        render: (value, _record, index) =>
            index === 0
                ? {
                      children: <strong>merged across three columns</strong>,
                      props: {colSpan: 3},
                  }
                : (value as string),
    },
    {
        ...baseColumns[2],
        render: (value, _record, index) =>
            index === 0 ? {children: null, props: {colSpan: 0}} : (value as string),
    },
    {
        ...baseColumns[3],
        render: (value, _record, index) =>
            index === 0 ? {children: null, props: {colSpan: 0}} : (value as string),
    },
    baseColumns[4],
]

export const MergedCells: Story = {
    render: () => (
        <Frame>
            <VirtualTable<Row>
                columns={mergedColumns}
                dataSource={makeRows(8)}
                rowKey={(row) => row.key}
                rowHeight={48}
                height={420}
            />
        </Frame>
    ),
}

/** Row clicks, and a cell that owns its own click without triggering the row. */
const RowInteractionDemo = () => {
    const [log, setLog] = useState("nothing clicked yet")

    const columns: ColumnDefs<Row> = [
        ...baseColumns.slice(0, 3),
        {
            key: "action",
            title: "Action",
            width: 140,
            render: (_value, record) => (
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation()
                        setLog(`cell button on ${record.id}`)
                    }}
                >
                    act
                </button>
            ),
        },
    ]

    return (
        <div className="flex flex-col gap-2">
            <Note>{log}</Note>
            <Frame>
                <VirtualTable<Row>
                    columns={columns}
                    dataSource={makeRows(20)}
                    rowKey={(row) => row.key}
                    rowHeight={48}
                    height={420}
                    onRow={(record) => ({onClick: () => setLog(`row ${record.id}`)})}
                />
            </Frame>
        </div>
    )
}

export const RowInteraction: Story = {render: () => <RowInteractionDemo />}

export const Empty: Story = {
    render: () => (
        <Frame>
            <VirtualTable<Row>
                columns={baseColumns}
                dataSource={[]}
                rowKey={(row) => row.key}
                rowHeight={48}
                height={420}
                emptyText={<span className="text-colorTextSecondary">No traces found</span>}
            />
        </Frame>
    ),
}

/**
 * The same columns and rows through antd's `<Table virtual>`, for a like-for-like read on
 * geometry and behaviour. This is the thing being replaced.
 */
const AntdComparisonDemo = () => {
    const rows = useMemo(() => makeRows(200), [])
    return (
        <div className="flex flex-col gap-6">
            <div>
                <p className="m-0 mb-2 text-xs font-medium">@agenta/ui VirtualTable</p>
                <Frame>
                    <VirtualTable<Row>
                        columns={baseColumns}
                        dataSource={rows}
                        rowKey={(row) => row.key}
                        rowHeight={48}
                        height={420}
                    />
                </Frame>
            </div>
            <div>
                <p className="m-0 mb-2 text-xs font-medium">antd Table virtual</p>
                <div className="h-[420px]">
                    <AntTable
                        virtual
                        size="small"
                        columns={baseColumns as never}
                        dataSource={rows}
                        rowKey="key"
                        pagination={false}
                        scroll={{y: 380, x: 1160}}
                    />
                </div>
            </div>
        </div>
    )
}

export const AntdComparison: Story = {render: () => <AntdComparisonDemo />}

/**
 * The wrapper swap: the SAME `InfiniteVirtualTable` API, rendered by each engine.
 *
 * `engine="tanstack"` puts VirtualTable behind the public component, so the ~80 existing call
 * sites move over one at a time by flipping one prop rather than being rewritten. Both tables
 * below get identical props; differences here are regressions.
 */
const EngineSwapDemo = () => {
    const rows = useMemo(() => makeRows(12), [])
    const [clicked, setClicked] = useState("none")
    const common = {
        columns: baseColumns,
        dataSource: rows,
        rowKey: "key" as const,
        bodyHeight: 300,
        // Row clicks must survive the engine swap; they were the one silent loss.
        tableProps: {
            onRow: (record: Row) => ({onClick: () => setClicked(record.id)}),
        },
    }
    return (
        <div className="flex flex-col gap-4">
            <Note>
                Top: engine=&quot;antd&quot; (shipping). Bottom: engine=&quot;tanstack&quot;. Last
                row clicked: <span data-clicked>{clicked}</span>
            </Note>
            <div data-engine="antd" className="h-[340px]">
                <InfiniteVirtualTable<Row> {...common} engine="antd" />
            </div>
            <div data-engine="tanstack" className="h-[340px]">
                <InfiniteVirtualTable<Row> {...common} engine="tanstack" />
            </div>
        </div>
    )
}

export const EngineSwap: Story = {render: () => <EngineSwapDemo />}

/**
 * The imperative handle. `tableRef.current.scrollTo({index, align})` is the whole surface
 * InfiniteVirtualTable exposes, mapped onto the virtualizer. antd's align vocabulary
 * (top/bottom/auto) differs from the virtualizer's (start/end/auto), so it is translated.
 */
const ScrollToDemo = () => {
    const rows = useMemo(() => makeRows(500), [])
    const ref = useRef<VirtualTableHandle | null>(null)
    return (
        <div className="flex flex-col gap-2">
            <Note>Jump to a row by index; the row should land at the top of the viewport.</Note>
            <div className="flex gap-2">
                {[0, 100, 250, 499].map((index) => (
                    <button
                        key={index}
                        type="button"
                        data-jump={index}
                        className="border border-solid border-colorBorder bg-colorBgContainer px-2 py-1 text-xs"
                        onClick={() => ref.current?.scrollTo({index, align: "top"})}
                    >
                        Go to {index}
                    </button>
                ))}
            </div>
            <Frame>
                <VirtualTable<Row>
                    tableRef={ref}
                    columns={baseColumns}
                    dataSource={rows}
                    rowKey={(row) => row.key}
                    rowHeight={48}
                    height={420}
                />
            </Frame>
        </div>
    )
}

export const ScrollTo: Story = {render: () => <ScrollToDemo />}

/**
 * Everything at once, through the public `InfiniteVirtualTable` API on the tanstack engine.
 *
 * This is the "is the swap actually complete" test: selection, resizing, row clicks,
 * infinite loading, an imperative scrollTo, and a full-width expanded panel, all driven by
 * the props real call sites pass. It should render with no console warnings.
 */
const KitchenSinkDemo = () => {
    const [rows, setRows] = useState(() => makeRows(40))
    const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([])
    const [clicked, setClicked] = useState("none")
    const ref = useRef<VirtualTableHandle | null>(null)
    const loading = useRef(false)

    return (
        <div className="flex flex-col gap-2">
            <Note>
                Selected <span data-selected>{selectedRowKeys.length}</span>, rows{" "}
                <span data-rows>{rows.length}</span>, clicked <span data-clicked-ks>{clicked}</span>
            </Note>
            <button
                type="button"
                data-jump-ks
                className="w-24 border border-solid border-colorBorder bg-colorBgContainer px-2 py-1 text-xs"
                onClick={() => ref.current?.scrollTo({index: 30, align: "top"})}
            >
                Go to 30
            </button>
            <div className="h-[340px]">
                <InfiniteVirtualTable<Row>
                    engine="tanstack"
                    columns={baseColumns}
                    dataSource={rows}
                    rowKey="key"
                    bodyHeight={300}
                    tableRef={ref}
                    resizableColumns
                    loadMore={() => {
                        if (loading.current || rows.length >= 80) return
                        loading.current = true
                        setRows((prev) => [...prev, ...makeRows(20, prev.length)])
                        loading.current = false
                    }}
                    rowSelection={{
                        selectedRowKeys,
                        onChange: (keys) => setSelectedRowKeys(keys),
                    }}
                    tableProps={{onRow: (record: Row) => ({onClick: () => setClicked(record.id)})}}
                />
            </div>
        </div>
    )
}

export const KitchenSink: Story = {render: () => <KitchenSinkDemo />}

/**
 * `typeChips` on both engines. It rewrites each column's `title` to carry a type chip, and
 * that rewrite happens on the shared columns before either engine renders, so both should
 * show the same chips. This story is the check on that reasoning.
 */
const TypeChipsDemo = () => {
    const rows = useMemo(() => makeRows(10), [])
    const getRowValue = useCallback(
        (record: Row, columnKey: string) =>
            (record as unknown as Record<string, unknown>)[columnKey],
        [],
    )
    const common = {
        columns: baseColumns,
        dataSource: rows,
        rowKey: "key" as const,
        bodyHeight: 240,
        typeChips: {getRowValue},
    }
    return (
        <div className="flex flex-col gap-4">
            <Note>Both engines should render the same type chips in their headers.</Note>
            <div data-engine="antd" className="h-[280px]">
                <InfiniteVirtualTable<Row> {...common} engine="antd" />
            </div>
            <div data-engine="tanstack" className="h-[280px]">
                <InfiniteVirtualTable<Row> {...common} engine="tanstack" />
            </div>
        </div>
    )
}

export const TypeChips: Story = {render: () => <TypeChipsDemo />}

/**
 * `size` and `bordered`, the last two antd props the tanstack engine did not implement.
 * They are what blocked the observability tables from swapping, so both engines render
 * them here side by side.
 */
const DensityDemo = () => {
    const rows = useMemo(() => makeRows(8), [])
    const common = {
        columns: baseColumns.slice(0, 3),
        dataSource: rows,
        rowKey: "key" as const,
        bodyHeight: 200,
    }
    // The observability tables pass `bordered` with no size, so the DEFAULT has to match too.
    const sizes = [undefined, "small", "middle", "large"] as const
    return (
        <div className="flex flex-col gap-4">
            <Note>Each size, both engines, bordered. Heights should match per row.</Note>
            {sizes.map((size) => (
                <div key={String(size)} className="flex flex-col gap-1">
                    <span className="text-xs text-colorTextSecondary">size={String(size)}</span>
                    <div data-size={String(size)} className="flex gap-2">
                        <div data-engine="antd" className="h-[200px] flex-1">
                            <InfiniteVirtualTable<Row>
                                {...common}
                                tableProps={{size, bordered: true}}
                                engine="antd"
                            />
                        </div>
                        <div data-engine="tanstack" className="h-[200px] flex-1">
                            <InfiniteVirtualTable<Row>
                                {...common}
                                tableProps={{size, bordered: true}}
                                engine="tanstack"
                            />
                        </div>
                    </div>
                </div>
            ))}
        </div>
    )
}

export const Density: Story = {render: () => <DensityDemo />}

/**
 * `loading` and `style`, both passed through `tableProps` by real call sites. The
 * observability table uses `loading` on every refetch, so flipping engines without it
 * would have silently removed the spinner.
 */
export const Loading: Story = {
    render: () => (
        <div className="flex flex-col gap-4">
            <Note>Left: loading. Right: idle. Both engines share the prop path.</Note>
            <div data-engine="tanstack" className="h-[240px]">
                <InfiniteVirtualTable<Row>
                    engine="tanstack"
                    columns={baseColumns.slice(0, 3)}
                    dataSource={makeRows(6)}
                    rowKey="key"
                    bodyHeight={200}
                    tableProps={{loading: true, style: {cursor: "pointer"}}}
                />
            </div>
        </div>
    ),
}
