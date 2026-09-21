import type {Meta, StoryObj} from "@storybook/nextjs"

import {ChannelConnectFlow} from "./ChannelConnectFlow"
import {ConnectFlowHost, SLACK_SETUP, TELEGRAM_LINK, TELEGRAM_SETUP} from "./storyFixtures"

/**
 * **The connect flow for one platform.** Hosted Telegram mints a one-time link, shows it as a QR
 * code, and waits for the /start that binds the chat. Hosted Slack opens the install redirect and
 * waits for the connection to appear. The custom tab renders the fields the backend declares.
 *
 * Nothing here simulates a handshake: every state comes from the actions. The stories pass fake
 * actions that resolve after a short delay over an in-memory fixture, so each state is reached the
 * way the product reaches it. Close the panel and open it again to run a flow from the start.
 */
const meta = {
    title: "@agenta/settings-ui/Channels/ChannelConnectFlow",
    component: ChannelConnectFlow,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The connect flow, shared by the desktop drawer and the /m sheet. The tabs " +
                    "are the Agenta-hosted app or bot and the customer's own.",
            },
        },
    },
} satisfies Meta<typeof ChannelConnectFlow>

export default meta
type Story = StoryObj

/** Telegram, hosted: mint, QR, wait, linked. */
export const TelegramHostedQr: Story = {
    render: () => (
        <ConnectFlowHost
            platform="telegram"
            pollIntervalMs={1000}
            options={{
                telegramLink: TELEGRAM_LINK,
                telegramBindAfterMs: 6000,
                setup: {telegram: TELEGRAM_SETUP},
            }}
        />
    ),
    parameters: {
        docs: {
            description: {
                story:
                    "The link is minted, then shown as a QR code with the bot name read from the " +
                    'link itself. Press "Continue in Telegram" to reach the waiting state. It ' +
                    "opens the Telegram link in a new tab, which is what the product does. About " +
                    "six seconds later the fake actions report a bound chat and the flow shows " +
                    "the linked state.",
            },
        },
    },
}

/** Telegram, hosted: the deployment has no hosted bot. */
export const TelegramHostedUnavailable: Story = {
    render: () => (
        <ConnectFlowHost
            platform="telegram"
            options={{
                telegramLink: null,
                telegramError:
                    "The hosted Telegram bot is not available on this deployment. Use your own bot instead.",
                setup: {telegram: TELEGRAM_SETUP},
            }}
        />
    ),
    parameters: {
        docs: {
            description: {
                story:
                    "The mint rejects. The flow keeps the message the action carried and offers " +
                    "the two ways out: try again, or switch to your own bot.",
            },
        },
    },
}

/** Telegram, hosted: the link expires while the flow waits. */
export const TelegramHostedExpired: Story = {
    render: () => (
        <ConnectFlowHost
            platform="telegram"
            pollIntervalMs={500}
            options={{
                telegramLink: {...TELEGRAM_LINK, expiresInSeconds: 3},
                setup: {telegram: TELEGRAM_SETUP},
            }}
        />
    ),
    parameters: {
        docs: {
            description: {
                story:
                    'The link lasts three seconds here, and no chat ever binds. Press "Continue ' +
                    'in Telegram" and the wait turns into the expired state, which says nothing ' +
                    "was linked and mints a new link on request.",
            },
        },
    },
}

/** Telegram, custom: the fields the backend declares for your own bot. */
export const TelegramCustomBot: Story = {
    render: () => (
        <ConnectFlowHost
            platform="telegram"
            mode="custom"
            options={{setup: {telegram: TELEGRAM_SETUP}}}
        />
    ),
    parameters: {
        docs: {
            description: {
                story:
                    "The story opens on the custom tab. The two steps come from the flow; the " +
                    "bot token field, its label, its help text and its secret and required flags " +
                    "all come from the declaration `loadSetup` returns. Fill the token to enable " +
                    "the connect button.",
            },
        },
    },
}

/** Telegram, custom: Telegram rejects the token. */
export const TelegramCustomRejected: Story = {
    render: () => (
        <ConnectFlowHost
            platform="telegram"
            mode="custom"
            options={{
                setup: {telegram: TELEGRAM_SETUP},
                connectCustomError: "Telegram rejected the bot token. Check it with @BotFather.",
            }}
        />
    ),
    parameters: {
        docs: {
            description: {
                story:
                    "Fill the token and connect. The action rejects, the flow shows the message " +
                    "it carried, and the fields keep what was typed.",
            },
        },
    },
}

/** Slack, hosted: the install redirect, then the wait for the connection. */
export const SlackHostedInstall: Story = {
    render: () => (
        <ConnectFlowHost
            platform="slack"
            capturePopups
            pollIntervalMs={1000}
            options={{
                slackInstallUrl: "https://example.invalid/install",
                slackConnectsAfterMs: 4000,
                setup: {slack: SLACK_SETUP},
            }}
        />
    ),
    parameters: {
        docs: {
            description: {
                story:
                    'In the product, "Add to Slack" opens the install redirect in a new tab and ' +
                    "the flow waits for the connection to appear. This story holds `window.open` " +
                    "and reports the URL under the panel instead of leaving Storybook. About " +
                    "four seconds later the fake actions report the connection, the flow points " +
                    "it at this agent, and the wait ends.",
            },
        },
    },
}

/** Slack, hosted: the deployment has no hosted app. */
export const SlackHostedUnavailable: Story = {
    render: () => (
        <ConnectFlowHost
            platform="slack"
            capturePopups
            options={{slackInstallUrl: null, setup: {slack: SLACK_SETUP}}}
        />
    ),
    parameters: {
        docs: {
            description: {
                story:
                    'Press "Add to Slack". The install URL resolves to nothing, so no window is ' +
                    "opened and the flow says this deployment has no hosted Slack app and points " +
                    "at the custom tab.",
            },
        },
    },
}

/** Slack, custom: the manifest guide and the credential fields. */
export const SlackCustomApp: Story = {
    render: () => (
        <ConnectFlowHost platform="slack" mode="custom" options={{setup: {slack: SLACK_SETUP}}} />
    ),
    parameters: {
        docs: {
            description: {
                story:
                    "The story opens on the custom tab, at the choice between creating an app " +
                    'and using one you already have. "Create the app" opens the manifest guide, ' +
                    'with copy and review for the manifest the backend declared. "Next" reaches ' +
                    "the two declared credential fields, both secret and both required.",
            },
        },
    },
}
