import type {
    ToolCatalogAction,
    ToolCatalogIntegration,
    ToolCatalogIntegrationDetails,
    ToolConnection,
} from "@agenta/entities/gatewayTool"
import type {QueryKey} from "@tanstack/react-query"

import type {StoryScope} from "../.storybook/decorators/withAgentaData"

/**
 * Fixture builders for the agent config panel's **Integrations** surfaces — the integration rows
 * in `ToolManagementList`, `IntegrationPermissionDrawer`, and `AgentIntegrationDrawer`.
 *
 * `gatewayTool` carries no zod schemas of its own (its types come straight from the generated Fern
 * client), so drift protection here is the TYPE: every payload is annotated with the same
 * `AgentaApi.*` alias the hooks consume, and a wire change fails this file at compile time.
 *
 * The catalog query is project-scoped, so its key is built from the story's `scope.projectId` —
 * pass these builders to `parameters.agenta.queries` in the function form, never as a static array.
 */

const PROVIDER = "composio"

export const GITHUB_TOOLS: ToolCatalogAction[] = [
    {key: "GITHUB_GET_ISSUE", name: "Get issue", description: "Read one issue", read_only: true},
    {key: "GITHUB_LIST_ISSUES", name: "List issues", description: "Read issues", read_only: true},
    {key: "GITHUB_SEARCH_CODE", name: "Search code", description: "Search a repo", read_only: true},
    {
        key: "GITHUB_CREATE_ISSUE",
        name: "Create issue",
        description: "Open a new issue",
        read_only: false,
    },
    {
        key: "GITHUB_MERGE_PR",
        name: "Merge pull request",
        description: "Merge an open PR",
        read_only: false,
    },
    // No `read_only` flag: an absent flag counts as a write, so this lands in the write group.
    {key: "GITHUB_DELETE_REPO", name: "Delete repository", description: "Remove a repo"},
]

export const GITHUB_DETAIL: ToolCatalogIntegrationDetails = {
    key: "github",
    name: "GitHub",
    description: "Repos, issues and pull requests",
    logo: null,
    categories: ["Developer Tools"],
    auth_schemes: ["oauth"],
    actions_count: GITHUB_TOOLS.length,
}

export const SLACK_DETAIL: ToolCatalogIntegrationDetails = {
    key: "slack",
    name: "Slack",
    description: "Messages, channels and reactions",
    logo: null,
    categories: ["Communication"],
    auth_schemes: ["oauth"],
    actions_count: 2,
}

export const LINEAR_DETAIL: ToolCatalogIntegrationDetails = {
    key: "linear",
    name: "Linear",
    description: "Issues and projects",
    logo: null,
    categories: ["Productivity"],
    auth_schemes: ["oauth"],
    actions_count: 4,
}

/** The catalog list behind the add drawer's "All apps" section. */
export const CATALOG_INTEGRATIONS: ToolCatalogIntegration[] = [
    GITHUB_DETAIL,
    SLACK_DETAIL,
    LINEAR_DETAIL,
]

export function connection(
    slug: string,
    integrationKey: string,
    flags: {is_active: boolean; is_valid: boolean} = {is_active: true, is_valid: true},
): ToolConnection {
    return {
        id: `conn-${slug}`,
        slug,
        name: slug,
        provider_key: PROVIDER,
        integration_key: integrationKey,
        flags,
    } as ToolConnection
}

export const GITHUB_WORK = connection("github-work", "github")
export const GITHUB_PERSONAL = connection("github-personal", "github")
export const SLACK_OPS = connection("slack-ops", "slack")
/** Connected but not usable — the add drawer shows a reconnect hint instead of Add. */
export const LINEAR_BROKEN = connection("linear-main", "linear", {
    is_active: true,
    is_valid: false,
})

const infinitePage = (page: Record<string, unknown>) => ({pages: [page], pageParams: [""]})

/**
 * Everything an integration surface reads: the project connections, the per-integration detail
 * (each row's logo and display name), the complete action catalog, and the browse lists.
 */
export function integrationQueries(
    scope: StoryScope,
    options: {
        connections?: ToolConnection[]
        catalog?: ToolCatalogAction[]
        catalogIntegrations?: ToolCatalogIntegration[]
    } = {},
): [QueryKey, unknown][] {
    const connections = options.connections ?? [GITHUB_WORK]
    const catalog = options.catalog ?? GITHUB_TOOLS
    const integrations = options.catalogIntegrations ?? CATALOG_INTEGRATIONS

    return [
        // The project-wide connections list.
        [["tools", "connections", scope.projectId], {connections, count: connections.length}],
        // Per-integration detail — each row's logo and display name.
        [["tools", "catalog", "integrationDetail", PROVIDER, "github"], GITHUB_DETAIL],
        [["tools", "catalog", "integrationDetail", PROVIDER, "slack"], SLACK_DETAIL],
        [["tools", "catalog", "integrationDetail", PROVIDER, "linear"], LINEAR_DETAIL],
        // The COMPLETE catalog the permission drawer partitions and counts.
        [["tools", "catalog", "integrationCatalog", scope.projectId, PROVIDER, "github"], catalog],
        // The add drawer's browse lists.
        [
            ["tools", "catalog", "integrations", PROVIDER, "", ""],
            infinitePage({integrations, cursor: null, total: integrations.length}),
        ],
        [
            ["tools", "catalog", "categories", PROVIDER],
            {
                categories: [
                    {id: "dev", name: "Developer Tools"},
                    {id: "comms", name: "Communication"},
                    {id: "prod", name: "Productivity"},
                ],
            },
        ],
    ]
}
