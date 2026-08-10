import {useState, type ReactNode} from "react"

import {Button} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button as AntButton} from "antd"

// Imported from source: the DrillInView barrel does not re-export the agent catalog drawer.
import {AgentIntegrationDrawer} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/AgentIntegrationDrawer"

// AgentIntegrationDrawer — the agent-playground tools catalog drawer. Its body is the SHARED
// `CatalogChooser` (already antd-free) and its chrome is `EnhancedDrawer` (already a facade over
// the Radix `Sheet` at the storybook-data-seam baseline), so the only antd this file carried was
// the footer's primary "Done" button.
//
// antd swap: `Button type="primary"` → `@agenta/ui` `Button variant="default"`.
//
// That makes the footer strip the whole parity pair; `OpenState` renders the real drawer over
// seeded catalog queries as the visual/a11y inventory entry (no antd half exists for the chrome
// or the body, so it is a showcase, not a pixel gate).
const meta = {
    title: "@agenta/entity-ui/DrillIn/AgentIntegrationDrawer",
    component: AgentIntegrationDrawer,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Tools catalog drawer for the agent playground: the shared CatalogChooser (app grid + connections rail + action list) with an 'add the action as a tool' leaf, a progress count in the footer, and an explicit Done exit (backdrop clicks do not close it mid-connect).",
            },
        },
    },
} satisfies Meta<typeof AgentIntegrationDrawer>

export default meta
type Story = StoryObj

const noop = () => undefined

// ---------------------------------------------------------------------------
// Parity grid — the footer strip
// ---------------------------------------------------------------------------

const Row = ({
    label,
    a,
    s,
    expected,
}: {
    label: string
    a: ReactNode
    s: ReactNode
    expected?: string
}) => (
    <div
        className="grid grid-cols-[10rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <div data-vrt-subject className="flex-1">
                {a}
            </div>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div data-vrt-subject className="flex-1">
                {s}
            </div>
        </div>
    </div>
)

const Footer = ({count, done}: {count: number; done: ReactNode}) => (
    <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-xs text-[var(--ag-c-97A4B0,#97a4b0)]">
            {count > 0
                ? `${count} app ${count === 1 ? "tool" : "tools"} added`
                : "Pick actions from a connected app — added instantly."}
        </span>
        {done}
    </div>
)

/** The drawer footer: the progress copy plus the primary Done exit. */
export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[1000px] flex-col">
            <Row
                label="footer · nothing added"
                a={<Footer count={0} done={<AntButton type="primary">Done</AntButton>} />}
                s={<Footer count={0} done={<Button variant="default">Done</Button>} />}
            />
            <Row
                label="footer · 1 tool added"
                a={<Footer count={1} done={<AntButton type="primary">Done</AntButton>} />}
                s={<Footer count={1} done={<Button variant="default">Done</Button>} />}
            />
            <Row
                label="footer · many added"
                a={<Footer count={4} done={<AntButton type="primary">Done</AntButton>} />}
                s={<Footer count={4} done={<Button variant="default">Done</Button>} />}
            />
        </div>
    ),
}

// ---------------------------------------------------------------------------
// Data-seam showcase: the real drawer over seeded catalog queries
// ---------------------------------------------------------------------------

const INTEGRATIONS = [
    {
        key: "github",
        name: "GitHub",
        description: "Repos, issues and pull requests",
        logo: null,
        actions_count: 3,
        categories: ["Developer Tools"],
        auth_schemes: ["oauth2"],
    },
    {
        key: "slack",
        name: "Slack",
        description: "Messages, channels and reactions",
        logo: null,
        actions_count: 2,
        categories: ["Communication"],
        auth_schemes: ["oauth2"],
    },
]

const ACTIONS = [
    {
        key: "GITHUB_CREATE_ISSUE",
        name: "Create issue",
        description: "Open a new issue in a repository",
        categories: ["Issues"],
    },
    {
        key: "GITHUB_MERGE_PR",
        name: "Merge pull request",
        description: "Merge an open pull request",
        categories: ["Pull Requests"],
    },
    {key: "GITHUB_STAR_REPO", name: "Star repository"},
]

const CONNECTIONS = [
    {
        id: "conn-agent-catalog-1",
        slug: "acme-github",
        name: "acme-github",
        provider_key: "composio",
        integration_key: "github",
        flags: {is_active: true, is_valid: true},
    },
]

const infinitePage = (page: Record<string, unknown>) => ({pages: [page], pageParams: [""]})

const catalogQueries = [
    [["tools", "connections"], {connections: CONNECTIONS, count: 1}],
    [
        ["tools", "catalog", "integrations", "composio", "", ""],
        infinitePage({integrations: INTEGRATIONS, cursor: null, total: 2}),
    ],
    [
        ["tools", "catalog", "categories", "composio"],
        {
            categories: [
                {id: "dev", name: "Developer Tools"},
                {id: "comms", name: "Communication"},
            ],
        },
    ],
    [
        ["tools", "catalog", "actions", "composio", "github", ""],
        infinitePage({actions: ACTIONS, cursor: null, total: 3}),
    ],
    [["tools", "connections", "composio", "github"], {connections: CONNECTIONS, count: 1}],
    [
        ["tools", "catalog", "actions", "composio", "slack", ""],
        infinitePage({actions: [], cursor: null, total: 0}),
    ],
    [["tools", "connections", "composio", "slack"], {connections: [], count: 0}],
]

// The drawer is a controlled overlay; the host owns `open`.
function DrawerHost({
    defaultIntegrationKey,
    selected = new Set<string>(),
}: {
    defaultIntegrationKey?: string
    selected?: Set<string>
}) {
    const [open, setOpen] = useState(true)
    return (
        <div className="min-h-[560px]">
            <Button variant="outline" onClick={() => setOpen(true)}>
                Add app tools
            </Button>
            <AgentIntegrationDrawer
                open={open}
                onClose={() => setOpen(false)}
                onAddTool={noop}
                selectedGatewayIds={selected}
                defaultIntegrationKey={defaultIntegrationKey}
            />
        </div>
    )
}

/** Open on the app grid: connections rail, category rail, integration cards, empty footer copy. */
export const OpenState: Story = {
    parameters: {agenta: {queries: catalogQueries}},
    render: () => <DrawerHost />,
}

/** Preselected app: straight to GitHub's action list, with one action already added. */
export const OpenOnIntegration: Story = {
    parameters: {agenta: {queries: catalogQueries}},
    render: () => (
        <DrawerHost
            defaultIntegrationKey="github"
            selected={new Set(["composio:github:GITHUB_CREATE_ISSUE:acme-github"])}
        />
    ),
}
