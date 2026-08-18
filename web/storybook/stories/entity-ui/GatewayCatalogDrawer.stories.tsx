import {useState} from "react"

import {
    GatewayCatalogDrawer,
    type CatalogAdapter,
    type CatalogConfig,
} from "@agenta/entity-ui/drawers/shared"
import {Button} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

// GatewayCatalogDrawer — the shared Composio catalog drawer (connections rail + app grid +
// per-app items view). antd `Drawer size="large"` → `EnhancedDrawer width={736}` (the
// antd-compatible facade over the @agenta/ui Sheet), plus Input/Spin/Empty/Tag/Card/
// Dropdown.Button swaps. A parity pair would duplicate the whole pre-migration file, so this
// is an interactive showcase: open the drawer, browse, click an app for the items view
// (Connect split-button, expandable description, item cards).
const meta = {
    title: "@agenta/entity-ui/Drawers/GatewayCatalogDrawer",
    component: GatewayCatalogDrawer,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The trigger/tool catalog drawer. antd `Drawer` → `EnhancedDrawer` (Sheet facade), `Dropdown.Button` → `DropdownButton`, `Card` → div + tokens, `Empty` → `EmptyState`, `Typography.Paragraph ellipsis` → composed ExpandableText. Showcase story (no parity pair).",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

interface Intg {
    key: string
    name: string
    description?: string
    categories?: string[]
    count?: number
}
interface Item {
    key: string
    name: string
    description?: string
    categories?: string[]
}
interface Conn {
    id: string
    name?: string
    slug?: string
    integrationKey: string
    active: boolean
}

const INTEGRATIONS: Intg[] = [
    {
        key: "github",
        name: "GitHub",
        description:
            "GitHub is a developer platform for hosting and reviewing code, managing projects, and building software alongside your team. This longer description exists to exercise the expandable three-line clamp in the items view, where it should truncate with a see-more toggle rather than pushing the search box down.",
        categories: ["Developer Tools"],
        count: 42,
    },
    {key: "slack", name: "Slack", description: "Messages and channels", count: 18},
    {key: "linear", name: "Linear", description: "Issues and projects", count: 12},
]

const ITEMS: Item[] = [
    {
        key: "issue.created",
        name: "Issue created",
        description: "Fires when an issue is opened",
        categories: ["Issues"],
    },
    {key: "pr.merged", name: "PR merged", description: "Fires on merge", categories: ["CI/CD"]},
    {key: "star.added", name: "Star added"},
]

const CONNECTIONS: Conn[] = [
    {id: "c1", name: "acme-org", slug: "acme-org", integrationKey: "github", active: true},
]

const noop = () => undefined

const adapter: CatalogAdapter<Intg, Item, Conn> = {
    useIntegrations: () => ({
        total: INTEGRATIONS.length,
        prefetchThreshold: 2,
        isLoading: false,
        hasNextPage: false,
        isFetchingNextPage: false,
        requestMore: noop,
        items: INTEGRATIONS,
    }),
    useConnections: () => ({connections: CONNECTIONS}),
    useIntegrationConnections: (key) => ({
        connections: CONNECTIONS.filter((c) => c.integrationKey === key),
    }),
    useItems: () => ({
        total: ITEMS.length,
        prefetchThreshold: 2,
        isLoading: false,
        hasNextPage: false,
        isFetchingNextPage: false,
        requestMore: noop,
        items: ITEMS,
    }),
    isConnectionActive: (c) => c.active,
    integrationFromConnection: (c) => ({key: c.integrationKey, name: c.integrationKey}),
    setIntegrationsSearch: noop,
    setItemsSearch: noop,
    integration: {
        key: (i) => i.key,
        name: (i) => i.name,
        logo: () => undefined,
        description: (i) => i.description,
        authSchemes: () => [],
        categories: (i) => i.categories,
        itemCount: (i) => i.count,
    },
    connection: {
        id: (c) => c.id,
        name: (c) => c.name,
        slug: (c) => c.slug,
        integrationKey: (c) => c.integrationKey,
    },
    item: {
        key: (t) => t.key,
        name: (t) => t.name,
        description: (t) => t.description,
        categories: (t) => t.categories,
    },
}

const config: CatalogConfig<Intg, Item, Conn> = {
    title: (selected) => (selected ? selected.name : "Add a trigger"),
    appsSearchPlaceholder: "Search apps…",
    itemsSearchPlaceholder: "Search events…",
    connectionsHint: "Events fire through your connected accounts.",
    emptyItemsText: "This app exposes no events.",
    onPickItem: noop,
    itemTrailing: (_c, item) => (item.key === "issue.created" ? "selected" : "add"),
    onConnectionMenu: noop,
    renderConnect: () => null,
}

function DrawerHost() {
    const [open, setOpen] = useState(true)
    return (
        <div className="h-[560px]">
            <Button variant="outline" onClick={() => setOpen(true)}>
                Open catalog drawer
            </Button>
            <GatewayCatalogDrawer
                open={open}
                onClose={() => setOpen(false)}
                adapter={adapter}
                config={config}
            />
        </div>
    )
}

// Opens on mount: connections rail + searchable app grid; click GitHub for the items view
// (Connect split-button + expandable description + item cards + tags).
export const Showcase: Story = {
    render: () => <DrawerHost />,
}
