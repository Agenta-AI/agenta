import {useEffect, useMemo} from "react"

import {
    ColumnVisibilityPopoverContent,
    VirtualTable,
    createStandardColumns,
    useExpandableRows,
    type ColumnTreeNode,
    type ColumnVisibilityState,
    type InfiniteTableRowBase,
} from "@agenta/ui/table"
import type {Meta, StoryObj} from "@storybook/nextjs"

/**
 * The icons that `InfiniteVirtualTable` draws itself: the row actions button, the expand and
 * collapse circles (with the loading spinner), and the file and folder icons in the column
 * visibility list. This story is the before and after proof for the move from antd icons to
 * Phosphor icons.
 */
const meta = {
    title: "@agenta/ui/Table/TableIcons",
    parameters: {layout: "padded"},
} satisfies Meta

export default meta
type Story = StoryObj

interface Row extends InfiniteTableRowBase {
    id: string
    name: string
}

const rows: Row[] = [
    {key: "1", id: "1", name: "First Testset"},
    {key: "2", id: "2", name: "Second Testset"},
]

const Section = ({title, children}: {title: string; children: React.ReactNode}) => (
    <section className="flex flex-col gap-2">
        <h3 className="m-0 text-sm font-medium">{title}</h3>
        {children}
    </section>
)

const ActionsColumn = () => {
    const columns = useMemo(
        () =>
            createStandardColumns<Row>([
                {type: "text", key: "name", title: "Name", width: 240},
                {
                    type: "actions",
                    showColumnVisibility: false,
                    showCopyId: false,
                    items: [{key: "open", label: "Open", onClick: () => undefined}],
                },
            ]),
        [],
    )
    return (
        <div className="w-[360px] border border-solid border-colorBorderSecondary">
            <VirtualTable<Row>
                columns={columns}
                dataSource={rows}
                rowKey={(row) => row.key}
                rowHeight={48}
                height={160}
            />
        </div>
    )
}

const ExpandIcons = () => {
    const {renderExpandIcon, onExpand} = useExpandableRows<Row>({
        rowKey: "key",
        config: {
            // Row 1 stays collapsed, row 2 opens, row 3 never finishes loading.
            fetchChildren: (record) =>
                record.key === "3"
                    ? new Promise<never[]>(() => undefined)
                    : Promise.resolve([] as never[]),
            renderExpanded: () => null,
        },
    })
    const items: Row[] = [...rows, {key: "3", id: "3", name: "Third Testset"}]
    useEffect(() => {
        void onExpand(true, items[1])
        void onExpand(true, items[2])
    }, [])
    return (
        <div className="flex flex-col gap-2 text-sm">
            {items.map((row, index) => (
                <div key={row.key} className="flex items-center gap-2">
                    {renderExpandIcon(row)}
                    <span>{["Collapsed", "Expanded", "Loading"][index]}</span>
                </div>
            ))}
        </div>
    )
}

const visibilityTree: ColumnTreeNode[] = [
    {
        key: "group",
        label: "Inputs",
        checked: true,
        indeterminate: false,
        children: [
            {key: "a", label: "question", checked: true, indeterminate: false, children: []},
            {key: "b", label: "answer", checked: true, indeterminate: false, children: []},
        ],
    },
    {key: "c", label: "created_at", checked: true, indeterminate: false, children: []},
]

const visibilityControls: ColumnVisibilityState<Row> = {
    allKeys: ["group", "a", "b", "c"],
    leafKeys: ["a", "b", "c"],
    hiddenKeys: [],
    setHiddenKeys: () => undefined,
    isHidden: () => false,
    showColumn: () => undefined,
    hideColumn: () => undefined,
    toggleColumn: () => undefined,
    toggleTree: () => undefined,
    reset: () => undefined,
    visibleColumns: [],
    columnTree: visibilityTree,
    version: 0,
}

export const TableIcons: Story = {
    render: () => (
        <div className="flex w-[820px] flex-wrap items-start gap-10">
            <Section title="Row actions button">
                <ActionsColumn />
            </Section>
            <Section title="Expand, collapse and loading">
                <ExpandIcons />
            </Section>
            <Section title="Column visibility list">
                <div className="w-[300px] border border-solid border-colorBorderSecondary p-2">
                    <ColumnVisibilityPopoverContent<Row>
                        onClose={() => undefined}
                        controls={visibilityControls}
                    />
                </div>
            </Section>
        </div>
    ),
}
