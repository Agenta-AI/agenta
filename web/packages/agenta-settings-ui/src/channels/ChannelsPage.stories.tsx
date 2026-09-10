import type {Meta, StoryObj} from "@storybook/nextjs"

import {ChannelsPage} from "./ChannelsPage"
import {
    ChannelsPageHost,
    OTHER_AGENT,
    SLACK_SETUP,
    TELEGRAM_SETUP,
    slackHere,
    slackRevoked,
    telegramBotRemoved,
    telegramElsewhere,
    telegramHere,
    telegramPending,
    telegramRevoked,
} from "./storyFixtures"

/**
 * **The agent page's Channels card.** One row per platform, and one panel behind it. A channel
 * connection is one per project and answers as one agent, so each row is in one of three states
 * relative to the agent whose page is open: not connected, connected here, or connected to
 * another agent.
 *
 * The stories are wired to fake actions over an in-memory fixture, so the rows are clickable and
 * the flows behind them end in a real state. The panel is the story's own bordered box, because
 * the host supplies the container: a drawer on desktop, a bottom sheet on /m.
 */
const meta = {
    title: "@agenta/settings-ui/Channels/ChannelsPage",
    component: ChannelsPage,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Connect and manage the chat tools an agent answers in. The card summarizes " +
                    "each platform; the row opens the connect flow or the manage view in the " +
                    "panel the host renders.",
            },
        },
    },
} satisfies Meta<typeof ChannelsPage>

export default meta
type Story = StoryObj

const setup = {setup: {slack: SLACK_SETUP, telegram: TELEGRAM_SETUP}}

/** Nothing connected: both rows carry the pitch and a Connect button. */
export const NothingConnected: Story = {
    render: () => <ChannelsPageHost options={setup} />,
    parameters: {
        docs: {
            description: {
                story:
                    "The empty card. The line above the rows names the agent, and each row " +
                    "says what the platform is for. Open a row to start the connect flow.",
            },
        },
    },
}

/** Telegram answers as this agent: the row shows the bot, the chats, and a caret into manage. */
export const TelegramConnectedHere: Story = {
    render: () => (
        <ChannelsPageHost initial={{slack: null, telegram: telegramHere}} options={setup} />
    ),
    parameters: {
        docs: {
            description: {
                story:
                    "Connected here. The green dot, the bot handle and the chat count summarize " +
                    "the connection; the caret opens the manage view.",
            },
        },
    },
}

/** Slack here, Telegram pointed at another agent. */
export const TelegramConnectedElsewhere: Story = {
    render: () => (
        <ChannelsPageHost
            initial={{slack: slackHere, telegram: telegramElsewhere}}
            options={setup}
        />
    ),
    parameters: {
        docs: {
            description: {
                story: `Slack answers as this agent. Telegram answers as ${OTHER_AGENT.name}, so its row reads "Connected to ${OTHER_AGENT.name}" and offers "Connect here", which retargets the one project connection to this agent.`,
            },
        },
    },
}

/** Both platforms answer as this agent. */
export const BothConnected: Story = {
    render: () => (
        <ChannelsPageHost initial={{slack: slackHere, telegram: telegramHere}} options={setup} />
    ),
    parameters: {
        docs: {
            description: {
                story:
                    "Each row names the bot and counts the places it answers in, so the card " +
                    "answers “where does this agent speak?” without opening anything.",
            },
        },
    },
}

/** The hosted link is minted, but no chat has tapped Start. */
export const NotLinkedYet: Story = {
    render: () => (
        <ChannelsPageHost initial={{slack: null, telegram: telegramPending}} options={setup} />
    ),
    parameters: {
        docs: {
            description: {
                story:
                    "A connection exists, but nothing answers through it yet. The row warns and " +
                    "leads back into the connect flow rather than into an empty manage view.",
            },
        },
    },
}

/** A revoked credential: the card header carries the badge and the row turns red. */
export const NeedsAttention: Story = {
    render: () => (
        <ChannelsPageHost initial={{slack: slackRevoked, telegram: telegramHere}} options={setup} />
    ),
    parameters: {
        docs: {
            description: {
                story:
                    'Slack uninstalled the app. The card shows "Needs attention" and the row ' +
                    "reads as an error until the app is installed again.",
            },
        },
    },
}

/** Telegram threw the bot token away. */
export const TelegramTokenRevoked: Story = {
    render: () => (
        <ChannelsPageHost initial={{slack: slackHere, telegram: telegramRevoked}} options={setup} />
    ),
    parameters: {
        docs: {
            description: {
                story:
                    'A custom bot can be repaired in place, so the row says "update it" rather ' +
                    'than "reconnect". The panel behind it leads with the token form.',
            },
        },
    },
}

/** The bot was removed from a chat on the platform side. */
export const BotRemovedFromChat: Story = {
    render: () => (
        <ChannelsPageHost initial={{slack: null, telegram: telegramBotRemoved}} options={setup} />
    ),
    parameters: {
        docs: {
            description: {
                story:
                    "The connection is live, but the bot is no longer in one of the chats it was " +
                    "added to. The row warns and the card asks for attention.",
            },
        },
    },
}

/** The host has not loaded the connections yet. */
export const Loading: Story = {
    render: () => <ChannelsPageHost loading options={setup} />,
    parameters: {
        docs: {
            description: {
                story:
                    "The first load. The rows keep their shape and their subtitles read " +
                    "“Loading…”; the trailing affordance is held back until the state is known.",
            },
        },
    },
}
