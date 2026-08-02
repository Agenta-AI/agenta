import {useState} from "react"

import {CatalogChooser, type CatalogChooserProps} from "@agenta/entity-ui/drawers/shared"
import type {Meta, StoryObj} from "@storybook/nextjs"

// CatalogChooser — the Composio app/source chooser (rail + grid + detail). A full antd parity
// pair would mean duplicating the 1000-line pre-migration file, so this is a plain-args
// showcase: static adapter hooks feed the grid/rail so the migrated primitives (InputAffix
// search, Buttons, Spinner, Tooltip dots) render without a backend. Drill in by clicking.
const meta = {
    title: "@agenta/entity-ui/Drawers/CatalogChooser",
    component: CatalogChooser,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The shared catalog chooser. antd `Input prefix/allowClear` → `InputAffix`, `Spin` → `Spinner`, `Tooltip` → `@agenta/ui` Tooltip, `Button` → `@agenta/ui` Button. Showcase story (no parity pair — the pre-migration body is the whole file).",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

interface Intg {
    key: string
    name: string
    description: string
    categories: string[]
    actions: number
}
interface Item {
    key: string
    name: string
    description?: string
    deprecated?: boolean
    readOnly?: boolean
}
interface Conn {
    id: string
    name?: string
    slug?: string
    integrationKey: string
    ready: boolean
}

const INTEGRATIONS: Intg[] = [
    {
        key: "github",
        name: "GitHub",
        description: "Repos, issues and pull requests",
        categories: ["Developer Tools"],
        actions: 42,
    },
    {
        key: "slack",
        name: "Slack",
        description: "Messages, channels and reactions",
        categories: ["Communication"],
        actions: 18,
    },
    {
        key: "linear",
        name: "Linear",
        description: "Issues and projects",
        categories: ["Project Management"],
        actions: 12,
    },
    {
        key: "notion",
        name: "Notion",
        description: "Pages and databases",
        categories: ["Productivity"],
        actions: 25,
    },
]

const ITEMS: Item[] = [
    {key: "issue.created", name: "Issue created", description: "Fires when an issue is opened"},
    {key: "pr.merged", name: "Pull request merged", description: "Fires on merge to any branch"},
    {key: "star.added", name: "Star added", readOnly: true},
    {key: "push.legacy", name: "Push (legacy)", deprecated: true},
]

const CONNECTIONS: Conn[] = [
    {id: "c1", name: "acme-org", slug: "acme-org", integrationKey: "github", ready: true},
    {id: "c2", slug: "workspace-2", integrationKey: "slack", ready: false},
]

const noop = () => undefined

function makeProps(connections: Conn[]): CatalogChooserProps<Intg, Item, Conn> {
    return {
        connections,
        isConnectionReady: (c) => c.ready,
        useIntegrations: () => ({
            integrations: INTEGRATIONS,
            total: INTEGRATIONS.length,
            hasNextPage: false,
            isFetchingNextPage: false,
            isLoading: false,
            requestMore: noop,
            setSearch: noop,
            setCategory: noop,
        }),
        useCategories: () => ({
            categories: [
                {id: "dev", name: "Developer Tools"},
                {id: "comms", name: "Communication"},
                {id: "productivity", name: "Productivity"},
            ],
            isLoading: false,
        }),
        useItems: () => ({
            items: ITEMS,
            isLoading: false,
            hasNextPage: false,
            isFetchingNextPage: false,
            requestMore: noop,
            setSearch: noop,
        }),
        integration: {
            key: (i) => i.key,
            name: (i) => i.name,
            logo: () => undefined,
            description: (i) => i.description,
            categories: (i) => i.categories,
            actionsCount: (i) => i.actions,
        },
        connection: {
            id: (c) => c.id,
            name: (c) => c.name,
            slug: (c) => c.slug,
            integrationKey: (c) => c.integrationKey,
            connectedAt: () => "2 days ago",
        },
        item: {
            key: (t) => t.key,
            name: (t) => t.name,
            description: (t) => t.description,
            readOnly: (t) => t.readOnly,
            deprecated: (t) => t.deprecated,
        },
        itemsLabel: "Choose an event",
        itemsSearchPlaceholder: "Search events…",
        emptyItemsText: "This app exposes no events.",
        onPickItem: noop,
        itemState: (_c, t) => (t.key === "issue.created" ? "selected" : "add"),
        renderConnect: () => null,
    }
}

function ChooserBox({connections}: {connections: Conn[]}) {
    // Stable props object per mount (the hooks inside are static closures).
    const [props] = useState(() => makeProps(connections))
    return (
        <div className="h-[480px] w-[860px] overflow-hidden rounded-lg border border-solid border-colorBorderSecondary p-3">
            <CatalogChooser {...props} />
        </div>
    )
}

// Browse view: connections rail + category rail + app grid (search via InputAffix).
export const Browse: Story = {
    render: () => <ChooserBox connections={CONNECTIONS} />,
}

// Detail view: opens on the GitHub connection (item list with selected/read-only/deprecated rows).
export const ConnectionDetail: Story = {
    render: () => {
        const props = makeProps(CONNECTIONS)
        return (
            <div className="h-[480px] w-[860px] overflow-hidden rounded-lg border border-solid border-colorBorderSecondary p-3">
                <CatalogChooser {...props} defaultIntegrationKey="github" />
            </div>
        )
    },
}

// No connections and no categories: plain grid, no rail.
export const NoConnections: Story = {
    render: () => {
        const props = makeProps([])
        return (
            <div className="h-[480px] w-[860px] overflow-hidden rounded-lg border border-solid border-colorBorderSecondary p-3">
                <CatalogChooser {...props} useCategories={undefined} />
            </div>
        )
    },
}
