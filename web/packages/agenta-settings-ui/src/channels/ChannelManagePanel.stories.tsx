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
    SLACK_SETUP,
    TELEGRAM_SETUP,
    WORKSPACE_NAME,
    createChannelStoryActions,
    InlinePanel,
    slackCustomHere,
    slackHere,
    slackRevoked,
    telegramCustomHere,
    telegramElsewhere,
    telegramHere,
    telegramRevoked,
    type ChannelStoryActionsOptions,
} from "./storyFixtures"
import type {ChannelConnection, ChannelConnections} from "./types"

/**
 * **The manage view for a connected channel.** What is connected, where it answers, the two
 * behavior switches, who may message it, the shipped defaults under Advanced, and disconnect.
 *
 * Every mutation is real. Each rejects with a message the panel shows, the panel stays open, and
 * the row that failed re-reads its own state, so nothing on screen claims a change the backend
 * refused.
 */
const meta = {
    title: "@agenta/settings-ui/Channels/ChannelManagePanel",
    component: ChannelManagePanel,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "What a connected channel looks like from the agent page: the bot, the " +
                    "workspace or account, the status, where it answers, the two switches, and " +
                    "disconnect.",
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

const setup = {slack: SLACK_SETUP, telegram: TELEGRAM_SETUP}

/**
 * The manage view inside the story panel, with the fake actions wired. The panel renders from
 * the fixture, so every switch, picker and form changes what is on screen.
 */
const ManageHost = ({
    connection: initial,
    options,
}: {
    connection: ChannelConnection
    options?: ChannelStoryActionsOptions
}) => {
    const [connection, setConnection] = useState<ChannelConnection | null>(initial)
    const [sentTo, setSentTo] = useState<string | null>(null)
    const [{actions}] = useState(() =>
        createChannelStoryActions({
            setup,
            ...options,
            connections: asConnections(initial),
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
                actions={actions}
                onUseOwnBot={() => setSentTo("the connect flow, on the custom tab")}
                onReconnect={() => setSentTo("the connect flow, to install it again")}
                onConnectHere={async () => {
                    await actions.connectHere(connection.platform, connection.connectionId ?? "")
                }}
                onDisconnect={async () => {
                    await actions.disconnect(connection.platform, connection.connectionId ?? "")
                }}
            />
            {sentTo ? (
                <p
                    className="m-0 mt-4 rounded-md border border-solid border-colorBorderSecondary bg-colorFillQuaternary p-2 text-xs text-colorTextSecondary"
                    data-testid="story-sent-to-connect"
                >
                    The host opens {sentTo}. In the product the panel swaps to it in place.
                </p>
            ) : null}
        </InlinePanel>
    )
}

/** Connected here, on the Agenta-hosted Telegram bot. */
export const ConnectedHere: Story = {
    render: () => <ManageHost connection={telegramHere} />,
    parameters: {
        docs: {
            description: {
                story:
                    "The plain case. The summary names the hosted bot, the account and the " +
                    "status; below it the chats it answers in, the two switches, who may " +
                    "message it, and the shipped defaults under Advanced.",
            },
        },
    },
}

/** Connected here on Slack, where a channel can be added from the panel. */
export const ConnectedHereSlack: Story = {
    render: () => <ManageHost connection={slackHere} />,
    parameters: {
        docs: {
            description: {
                story:
                    'Slack adds the workspace row and an "Add channel" action. Press it: the ' +
                    "picker lists the rooms the app can see and is not yet configured for, and " +
                    "choosing one adds it to the list above.",
            },
        },
    },
}

/** The customer's own Slack app instead of the hosted one. */
export const ConnectedHereCustomApp: Story = {
    render: () => <ManageHost connection={slackCustomHere} />,
    parameters: {
        docs: {
            description: {
                story:
                    "A custom app, so the bot row names your own app and the summary carries a " +
                    'Token row. "Update" asks for both secrets Slack issues: the bot token and ' +
                    "the signing secret.",
            },
        },
    },
}

/** The customer's own Telegram bot: the summary carries a Token row. */
export const ConnectedOwnTelegramBot: Story = {
    render: () => <ManageHost connection={telegramCustomHere} />,
    parameters: {
        docs: {
            description: {
                story:
                    'Only a custom bot has a secret of its own. "Update" opens an inline field ' +
                    "for a fresh token from @BotFather; the old one is never shown.",
            },
        },
    },
}

/** One switch is off, so the agent answers direct messages only. */
export const GroupChatsDenied: Story = {
    render: () => (
        <ManageHost
            connection={telegramHere}
            options={{behavior: {"cx-telegram": {dm: true, group: false}}}}
        />
    ),
    parameters: {
        docs: {
            description: {
                story:
                    "The switches are the agent's kind-level grants. Turning both back on " +
                    "deletes them, which is how the backend spells “answers everywhere”.",
            },
        },
    },
}

/** The switch cannot be saved. */
export const BehaviorSaveFails: Story = {
    render: () => (
        <ManageHost
            connection={telegramHere}
            options={{behaviorError: "Could not reach the server. The setting was not saved."}}
        />
    ),
    parameters: {
        docs: {
            description: {
                story:
                    "Flip a switch. The write rejects, the message appears above the rows, and " +
                    "the switch springs back because the panel re-reads the grants afterwards.",
            },
        },
    },
}

/** Only two Telegram accounts may talk to the bot. */
export const AllowedUsers: Story = {
    render: () => (
        <ManageHost
            connection={telegramHere}
            options={{allowedUsers: {"cx-telegram": ["123456789", "987654321"]}}}
        />
    ),
    parameters: {
        docs: {
            description: {
                story:
                    'The row reads "2 accounts" instead of "Everyone". Edit takes a ' +
                    'comma-separated list of Telegram user ids and confirms with "Saved".',
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
                story: `There is one Telegram connection per project and it answers as ${OTHER_AGENT.name}. The offer retargets it to this agent and the linked chats stay linked. Below the divider is the way out of the rule entirely: give ${AGENT_NAME} a bot of its own.`,
            },
        },
    },
}

/** Slack threw the install away. */
export const RevokedSlackApp: Story = {
    render: () => <ManageHost connection={slackRevoked} />,
    parameters: {
        docs: {
            description: {
                story:
                    "A hosted app has no secret to replace, so the alert offers Reconnect and " +
                    'the status row reads "Uninstalled" in error colour.',
            },
        },
    },
}

/** Telegram threw the bot token away. */
export const RevokedTelegramToken: Story = {
    render: () => <ManageHost connection={telegramRevoked} />,
    parameters: {
        docs: {
            description: {
                story:
                    'The alert leads with "Update token" and opens the same inline field the ' +
                    "Token row does. A token the fixture accepts brings the connection back.",
            },
        },
    },
}

/** The platform refuses the new token. */
export const TokenUpdateFails: Story = {
    render: () => (
        <ManageHost
            connection={telegramRevoked}
            options={{credentialsError: "Telegram rejected this token. Check it with @BotFather."}}
        />
    ),
    parameters: {
        docs: {
            description: {
                story:
                    "Paste anything and save. The form keeps what you typed and shows what " +
                    "Telegram said, so a typo costs one edit and not the whole form.",
            },
        },
    },
}

/** The disconnect is refused. */
export const DisconnectFails: Story = {
    render: () => (
        <ManageHost
            connection={telegramHere}
            options={{
                disconnectError: "Could not reach Telegram. The connection was left as it is.",
            }}
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
