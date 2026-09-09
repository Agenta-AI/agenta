import {useState} from "react"

import {Button} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {ChannelManagePanel} from "./ChannelManagePanel"
import {platformLabel} from "./helpers"
import {
    AGENT_ID,
    AGENT_NAME,
    HOSTED_HANDLE,
    OTHER_AGENT,
    WORKSPACE_NAME,
    createChannelStoryActions,
    InlinePanel,
    slackCustomHere,
    slackRevoked,
    telegramElsewhere,
    telegramHere,
} from "./storyFixtures"
import type {ChannelConnection, ChannelConnections} from "./types"

/**
 * **The manage view for a connected channel.** The summary of what is connected, the "connect
 * here" offer when the connection answers as another agent, and disconnect behind a confirmation.
 *
 * Both mutations are real. They reject with a message the panel shows, and the panel stays open on
 * failure, so nothing is lost when the backend refuses.
 */
const meta = {
    title: "@agenta/settings-ui/Channels/ChannelManagePanel",
    component: ChannelManagePanel,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "What a connected channel looks like from the agent page: the bot, the agent " +
                    "it answers as, the workspace for Slack, the connect date, and disconnect.",
            },
        },
    },
} satisfies Meta<typeof ChannelManagePanel>

export default meta
type Story = StoryObj

const asConnections = (connection: ChannelConnection): ChannelConnections =>
    connection.platform === "slack"
        ? {slack: connection, telegram: null}
        : {slack: null, telegram: connection}

/**
 * The manage view inside the story panel, with the fake actions wired. The panel renders from
 * the fixture, so "connect here" and disconnect change what is on screen.
 */
const ManageHost = ({
    connection: initial,
    disconnectError,
}: {
    connection: ChannelConnection
    disconnectError?: string
}) => {
    const [connection, setConnection] = useState<ChannelConnection | null>(initial)
    const [{actions}] = useState(() =>
        createChannelStoryActions({
            connections: asConnections(initial),
            disconnectError,
            onChange: (next) => setConnection(next[initial.platform]),
        }),
    )

    if (!connection) {
        return (
            <div className="flex flex-col items-start gap-3">
                <p className="m-0 text-[13px] text-colorTextSecondary">
                    Disconnected. The host closes the panel and the card row goes back to Connect.
                </p>
                <Button variant="outline" onClick={() => setConnection(initial)}>
                    Reset the story
                </Button>
            </div>
        )
    }

    const name = platformLabel(connection.platform)

    return (
        <InlinePanel
            title={name}
            subtitle={`${AGENT_NAME} · ${connection.platform === "slack" ? WORKSPACE_NAME : "Telegram"}`}
            onClose={() => undefined}
        >
            <ChannelManagePanel
                connection={connection}
                agentId={AGENT_ID}
                agentName={AGENT_NAME}
                workspaceName={WORKSPACE_NAME}
                hostedHandle={HOSTED_HANDLE}
                onConnectHere={async () => {
                    await actions.connectHere(connection.platform, connection.connectionId ?? "")
                }}
                onDisconnect={async () => {
                    await actions.disconnect(connection.platform, connection.connectionId ?? "")
                }}
            />
        </InlinePanel>
    )
}

/** Connected here, on the Agenta-hosted bot. */
export const ConnectedHere: Story = {
    render: () => <ManageHost connection={telegramHere} />,
    parameters: {
        docs: {
            description: {
                story:
                    "The plain case. The summary names the hosted bot, the agent that answers, " +
                    "and the connect date. Disconnect asks for a confirmation first.",
            },
        },
    },
}

/** Connected here, on the customer's own Slack app. */
export const ConnectedHereCustomApp: Story = {
    render: () => <ManageHost connection={slackCustomHere} />,
    parameters: {
        docs: {
            description: {
                story:
                    "A custom app instead of the hosted one, so the bot row names your own app. " +
                    "Slack adds the workspace row; Telegram has none.",
            },
        },
    },
}

/** Connected, but answering as another agent. */
export const ConnectedElsewhere: Story = {
    render: () => <ManageHost connection={telegramElsewhere} />,
    parameters: {
        docs: {
            description: {
                story: `There is one Telegram connection per project and it answers as ${OTHER_AGENT.name}. The offer explains the trade and retargets the connection to this agent; the chats stay linked. Press it and the panel re-renders as "connected here".`,
            },
        },
    },
}

/** The platform revoked the credential. */
export const Revoked: Story = {
    render: () => <ManageHost connection={slackRevoked} />,
    parameters: {
        docs: {
            description: {
                story:
                    "The agent cannot answer there until the connection is made again. The panel " +
                    "leads with the warning and keeps disconnect as the way forward.",
            },
        },
    },
}

/** The disconnect is refused. */
export const DisconnectFails: Story = {
    render: () => (
        <ManageHost
            connection={telegramHere}
            disconnectError="Could not reach Telegram. The connection was left as it is."
        />
    ),
    parameters: {
        docs: {
            description: {
                story:
                    "Press disconnect and confirm. The action rejects, the panel shows the " +
                    "message it carried, and it stays open with the connection intact.",
            },
        },
    },
}
