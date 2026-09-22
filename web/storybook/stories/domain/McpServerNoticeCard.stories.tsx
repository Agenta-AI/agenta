import {McpServerNoticeCard} from "@agenta/chat/components"
import {readMcpServerNotice} from "@agenta/chat/model"
import {MCP_ENDPOINTS_QUERY_KEY} from "@agenta/entities/mcpEndpoint"
import type {Meta, StoryObj} from "@storybook/nextjs"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"

/**
 * **What a turn says about a server that did not join the run.** Drawn as the spec's D4 banner,
 * so a lapsed login reads as the same sentence with the same action here and in the permission
 * drawer.
 *
 * Data-connected: the card resolves the connection itself, from the slug the notice carries, and
 * offers Reconnect only against a row it found. The project's connection list is seeded here, so
 * the difference between the first story and the last one is the seeded row, not a prop.
 */

/** The settings row for the server the notice names. */
const CONNECTED_ROW = {
    id: "endpoint-1",
    slug: "octolens",
    name: "Octolens",
    namespace: "custom",
    auth_mode: "oauth",
    data: {route: {base_url: "https://mcp.octolens.test"}},
}

const connectionQueries = (scope: StoryScope) => [
    [[MCP_ENDPOINTS_QUERY_KEY, scope.projectId], [CONNECTED_ROW]] as [unknown[], unknown],
]

/** The handshake refusal a disconnected OAuth connection produces, marker and all. */
const authRequired = (target = "custom/octolens") =>
    readMcpServerNotice({
        serverName: "octolens",
        reasonCode: "handshake_http_error",
        status: 409,
        message: "MCP server octolens failed to connect: 409",
        detail: {
            code: "auth_required",
            message: `Authorization required for ${target} ⟦agenta_code:auth_required⟧`,
            details: {
                cause: "auth_required",
                requirement: {
                    target,
                    state: "needs_auth",
                    connect: {endpoint: "/gateways/mcps/endpoints/endpoint-1/connect"},
                },
            },
        },
    })!

const meta = {
    title: "@agenta/chat/Domain/McpServerNoticeCard",
    component: McpServerNoticeCard,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The run's account of an MCP server that did not join it: the expired-login " +
                    "banner with Reconnect, or the run's own sentence when the cause is " +
                    "something else.",
            },
        },
        agenta: {queries: connectionQueries},
    },
    decorators: [
        (Story) => (
            <div className="w-[560px] max-w-full">
                <Story />
            </div>
        ),
    ],
} satisfies Meta<typeof McpServerNoticeCard>

export default meta
type Story = StoryObj<typeof meta>

/** The login lapsed. The banner names the connection and carries the one action that fixes it. */
export const NeedsAuthorization: Story = {
    args: {notice: authRequired()},
}

/** A failure nothing has classified. The run's own sentence stands, and no remedy is guessed at. */
export const OtherFailure: Story = {
    args: {
        notice: readMcpServerNotice({
            serverName: "octolens",
            reasonCode: "handshake_unreachable",
            message: "MCP server octolens failed to connect: handshake_unreachable",
            detail: null,
        })!,
    },
}

/**
 * The notice names a connection this project cannot see: removed, or someone else's. The sentence
 * is still worth reading, so it stays; a Reconnect that has no row to act on does not.
 */
export const UnresolvedConnection: Story = {
    args: {notice: authRequired("custom/some-other-slug")},
}
