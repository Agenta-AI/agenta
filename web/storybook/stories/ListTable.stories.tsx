import {useState} from "react"

import {
    ListTable,
    ListTableToolbar,
    ListTableViewToggle,
    type ListTableColumn,
    type ListTableGroup,
    type ListTableView,
} from "@agenta/ui/list-table"
import {Button} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

/**
 * `@agenta/ui/list-table` is the frame every table-shaped `/m` screen shares. It is column-agnostic
 * and entity-free, so the fixture here is a plain shape — what matters is the frame: the header,
 * the group headings, the collapse, the open affordance, and the two views over one set of rows.
 */
const meta = {
    title: "@agenta/ui/Patterns/ListTable",
    component: ListTable,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The shared list frame: a header row, group headings that collapse, rows that open — and, with `view=\"grid\"`, the same groups drawn as cards. `renderRow` draws a row's cells; `renderCard` draws a card's contents; the frame owns the chrome of both.\n\n**Used in:** `/m` agents, sessions, automations, skills; the drive's `FolderList`.",
            },
        },
    },
} satisfies Meta<typeof ListTable>

export default meta
type Story = StoryObj

interface Item {
    id: string
    name: string
    description: string
    source: string
    updated: string
}

const ITEMS: Item[] = [
    {
        id: "1",
        name: "ai-slop-cleaner",
        description: "Run an anti-slop cleanup workflow",
        source: "This project",
        updated: "12h ago",
    },
    {
        id: "2",
        name: "compare-to-reference",
        description: "Measure a finished reel against the reference it was meant to match",
        source: "acme/demo",
        updated: "10h ago",
    },
    {
        id: "3",
        name: "shoot-still",
        description: "Capture one region of a running app as a 4K image",
        source: "acme/demo",
        updated: "10h ago",
    },
    {
        id: "4",
        name: "intro-reel",
        description: "Make a ~15s launch-film intro for a product feature",
        source: "acme/demo",
        updated: "10h ago",
    },
]

const COLUMNS: ListTableColumn[] = [
    {key: "name", label: "Name", width: "minmax(160px,2fr)"},
    {key: "source", label: "Source", width: "minmax(120px,1fr)"},
    {key: "updated", label: "Last updated", width: "84px"},
]

const FLAT: ListTableGroup<Item>[] = [{key: "all", label: null, rows: ITEMS}]
const GROUPED: ListTableGroup<Item>[] = [
    {key: "project", label: "This project", rows: ITEMS.filter((i) => i.source === "This project")},
    {key: "acme", label: "acme/demo", rows: ITEMS.filter((i) => i.source === "acme/demo")},
]

const renderRow = (row: Item) => (
    <>
        <span className="flex min-w-0 flex-col">
            <span className="truncate font-mono text-[13px] text-foreground">{row.name}</span>
            <span className="truncate text-[13px] text-muted-foreground">{row.description}</span>
        </span>
        <span className="truncate text-[13px] text-muted-foreground">{row.source}</span>
        <span className="text-[13px] text-placeholder">{row.updated}</span>
    </>
)

const renderCard = (row: Item) => (
    <>
        <span className="truncate font-mono text-[13px] font-medium text-foreground">
            {row.name}
        </span>
        <span className="line-clamp-3 text-[12.5px] text-muted-foreground">{row.description}</span>
        <span className="mt-auto pt-2 text-[11.5px] text-placeholder">
            {row.source} · {row.updated}
        </span>
    </>
)

const Frame = ({
    view: initialView = "list",
    groups,
    loading,
    withActions,
}: {
    view?: ListTableView
    groups: ListTableGroup<Item>[]
    loading?: boolean
    withActions?: boolean
}) => {
    const [view, setView] = useState<ListTableView>(initialView)
    const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
    const [search, setSearch] = useState("")
    return (
        <div className="w-full max-w-[720px]">
            <ListTableToolbar
                search={search}
                onSearchChange={setSearch}
                searchPlaceholder="Search…"
                actions={
                    <ListTableViewToggle value={view} onChange={setView} className="ml-auto" />
                }
            />
            <ListTable
                columns={COLUMNS}
                minWidth={360}
                groups={groups}
                view={view}
                loading={loading}
                rowKey={(row) => row.id}
                renderRow={renderRow}
                renderCard={renderCard}
                onOpenRow={() => undefined}
                collapsedKeys={collapsed}
                onToggleGroup={(key) =>
                    setCollapsed((current) => {
                        const next = new Set(current)
                        if (!next.delete(key)) next.add(key)
                        return next
                    })
                }
                groupActions={
                    withActions
                        ? (group) =>
                              group.key === "acme" ? (
                                  <Button size="sm" variant="outline">
                                      Update 2 skills
                                  </Button>
                              ) : null
                        : undefined
                }
                empty={
                    <p className="py-10 text-center text-[13px] text-muted-foreground">
                        Nothing here.
                    </p>
                }
            />
        </div>
    )
}

export const List: Story = {render: () => <Frame groups={FLAT} />}
export const ListGrouped: Story = {render: () => <Frame groups={GROUPED} withActions />}
export const Grid: Story = {render: () => <Frame view="grid" groups={GROUPED} withActions />}
export const LoadingList: Story = {render: () => <Frame groups={FLAT} loading />}
export const LoadingGrid: Story = {render: () => <Frame view="grid" groups={FLAT} loading />}
export const Empty: Story = {render: () => <Frame groups={[{key: "all", label: null, rows: []}]} />}
