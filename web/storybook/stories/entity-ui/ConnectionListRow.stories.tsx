import {ConnectionListRow} from "@agenta/entity-ui/mcpEndpoint"
import type {Meta, StoryObj} from "@storybook/nextjs"

// One project MCP connection as the add-server drawer lists it: the neutral server mark, the
// name, and the host (or the status when the connection is not working), all in the sans font.
const meta = {
    title: "@agenta/entity-ui/McpEndpoint/ConnectionListRow",
    component: ConnectionListRow,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A row in the add-server drawer. A working connection offers Add, an expired " +
                    "one offers Reconnect and names its status in place of the host, and one " +
                    "already on the agent carries no action.",
            },
        },
    },
    args: {
        name: "Linear",
        host: "mcp.linear.app",
        status: "connected",
        onAdd: () => undefined,
        onReconnect: () => undefined,
    },
} satisfies Meta<typeof ConnectionListRow>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

/** Every row state, stacked the way the drawer lists them. */
export const AllStates: Story = {
    render: () => (
        <div className="flex max-w-[420px] flex-col px-2">
            <ConnectionListRow
                name="Linear"
                host="mcp.linear.app"
                status="connected"
                added
                onAdd={noop}
            />
            <ConnectionListRow name="Axiom" host="mcp.axiom.co" status="connected" onAdd={noop} />
            <ConnectionListRow
                name="Sentry"
                host="mcp.sentry.dev"
                status="connected"
                toolCount={12}
                onAdd={noop}
            />
            <ConnectionListRow
                name="Octolens"
                host="mcp.octolens.com"
                status="login_expired"
                onReconnect={noop}
            />
            <ConnectionListRow
                name="Internal docs"
                host="mcp.example.com"
                status="not_signed_in"
                onReconnect={noop}
            />
            <ConnectionListRow
                name="Axiom"
                host="mcp.axiom.co"
                status="connected"
                busy
                onAdd={noop}
            />
        </div>
    ),
}

/** A working connection, for the controls panel. */
export const Working: Story = {}

/** A login that expired: Reconnect, and the status where the host was. */
export const LoginExpired: Story = {args: {status: "login_expired"}}
