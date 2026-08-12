import {useMemo, useState} from "react"

import {VirtualTable, type ColumnDefs} from "@agenta/ui/table"
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

const makeRows = (count: number): Row[] =>
    Array.from({length: count}, (_, i) => ({
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
