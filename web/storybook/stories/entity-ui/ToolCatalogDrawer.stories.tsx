import {toolCatalogDrawerOpenAtom} from "@agenta/entities/gatewayTool"
import {CatalogDrawer} from "@agenta/entity-ui/gatewayTool"
import type {Meta, StoryObj} from "@storybook/nextjs"

// CatalogDrawer (gatewayTool) — atom-driven container over the infinite catalog queries.
// Data-seam story: `toolCatalogDrawerOpenAtom` opens it; the integrations fixture seeds the
// infinite-query cache shape ({pages, pageParams}). Clicking GitHub exercises the actions
// view (actions + connections fixtures below), including the Connect split button
// (was antd `Dropdown.Button`) and the expandable description.
//
// Fixture keys mirror the hooks: ["tools","catalog","integrations","composio","",""] and
// ["tools","catalog","actions","composio","github",""] (infinite), plus
// ["tools","connections","composio","github"] (flat). Search-driven keys re-fetch and log
// the missing-fixture warning — expected; the resting state is what this story pins.
//
// antd swaps: `Drawer size="large"` → `EnhancedDrawer`; `Card hoverable` → CatalogCard;
// `Empty` → `EmptyState`; `Input prefix/allowClear` → `InputAffix`; `Spin` → `Spinner`;
// `Badge count` → composed count pill; `Tag` → presentational `Tag`;
// `Typography.Paragraph ellipsis` → ExpandableText. Showcase story (portal — no parity pair).
const meta = {
    title: "@agenta/entity-ui/GatewayTool/CatalogDrawer",
    component: CatalogDrawer,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Browse-integrations drawer: search, infinite list of integration cards, per-integration actions view with the Connect split button.",
            },
        },
    },
} satisfies Meta<typeof CatalogDrawer>

export default meta
type Story = StoryObj

const INTEGRATIONS = [
    {
        key: "github",
        name: "GitHub",
        description:
            "GitHub is a developer platform for hosting and reviewing code, managing projects, and building software alongside your team. This longer description exercises the three-line clamp with the see-more toggle in the actions view.",
        logo: null,
        actions_count: 3,
        auth_schemes: ["oauth2"],
    },
    {
        key: "slack",
        name: "Slack",
        description: "Send messages, manage channels, and search your workspace.",
        logo: null,
        actions_count: 2,
        auth_schemes: ["oauth2", "api_key"],
    },
    {key: "linear", name: "Linear", description: null, logo: null, actions_count: 1},
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
        categories: ["Pull Requests", "CI"],
    },
    {key: "GITHUB_STAR_REPO", name: "Star repository"},
]

const CONNECTIONS = [
    {
        id: "conn-gtool-catalog-1",
        slug: "acme-github",
        name: "acme-github",
        provider_key: "composio",
        integration_key: "github",
        flags: {is_active: true, is_valid: true},
    },
]

const infinitePage = (page: Record<string, unknown>) => ({
    pages: [page],
    pageParams: [""],
})

/** Integrations list, with the GitHub actions view one click away. */
export const Open: Story = {
    parameters: {
        agenta: {
            atoms: [[toolCatalogDrawerOpenAtom, true]],
            queries: [
                [
                    ["tools", "catalog", "integrations", "composio", "", ""],
                    infinitePage({integrations: INTEGRATIONS, cursor: null, total: 3}),
                ],
                [
                    ["tools", "catalog", "actions", "composio", "github", ""],
                    infinitePage({actions: ACTIONS, cursor: null, total: 3}),
                ],
                [
                    ["tools", "connections", "composio", "github"],
                    {connections: CONNECTIONS, count: 1},
                ],
                [
                    ["tools", "catalog", "actions", "composio", "slack", ""],
                    infinitePage({actions: [], cursor: null, total: 0}),
                ],
                [["tools", "connections", "composio", "slack"], {connections: [], count: 0}],
                [
                    ["tools", "catalog", "actions", "composio", "linear", ""],
                    infinitePage({actions: [], cursor: null, total: 0}),
                ],
                [["tools", "connections", "composio", "linear"], {connections: [], count: 0}],
            ],
        },
    },
}

/** No integrations — the EmptyState branch. */
export const Empty: Story = {
    parameters: {
        agenta: {
            atoms: [[toolCatalogDrawerOpenAtom, true]],
            queries: [
                [
                    ["tools", "catalog", "integrations", "composio", "", ""],
                    infinitePage({integrations: [], cursor: null, total: 0}),
                ],
            ],
        },
    },
}
