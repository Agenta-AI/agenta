import type {Meta, StoryObj} from "@storybook/nextjs"

import {PublishMenu} from "./PublishMenu"

/**
 * **The agent header's Publish button.** One menu of the places an agent can be reached from:
 * Slack, Telegram and API. Each row shows "Set up" or "Live"; the header counts the live ones.
 * The API is live as soon as the agent has a saved revision — it can always be called — so it
 * only shows "Set up" for a draft agent that has not been saved yet. With the Channels
 * preference off, the host passes only API.
 */
const meta = {
    title: "@agenta/settings-ui/Publish/PublishMenu",
    component: PublishMenu,
    parameters: {layout: "centered"},
    args: {onSelect: () => undefined},
} satisfies Meta<typeof PublishMenu>

export default meta
type Story = StoryObj<typeof meta>

/** A draft agent: not saved yet, so nothing is live, including the API. */
export const NothingLive: Story = {
    args: {
        items: [
            {key: "slack", live: false},
            {key: "telegram", live: false},
            {key: "api", live: false},
        ],
    },
}

/** A saved agent: the API is always live, Slack and Telegram are not yet set up. */
export const SlackLive: Story = {
    args: {
        items: [
            {key: "slack", live: true},
            {key: "telegram", live: false},
            {key: "api", live: true},
        ],
    },
}

/** All three places live: "Live in 3 places". */
export const AllLive: Story = {
    args: {
        items: [
            {key: "slack", live: true},
            {key: "telegram", live: true},
            {key: "api", live: true},
        ],
    },
}

/** Channels loading: Slack and Telegram wait for the connections before they open a drawer. */
export const ChannelsLoading: Story = {
    args: {
        items: [
            {key: "slack", live: false, disabled: true},
            {key: "telegram", live: false, disabled: true},
            {key: "api", live: true},
        ],
    },
}

/** The Channels preference is off: only API is offered, live once the agent is saved. */
export const ChannelsHidden: Story = {
    args: {items: [{key: "api", live: true}]},
}
