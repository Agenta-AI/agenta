import type {Meta, StoryObj} from "@storybook/nextjs"

import {PublishMenu} from "./PublishMenu"

/**
 * **The agent header's Publish button.** One menu of the places an agent can be reached from:
 * Slack, Telegram and API. Each row shows "Set up" or "Live"; the header counts the live ones.
 * With the Channels preference off, the host passes only API.
 */
const meta = {
    title: "@agenta/settings-ui/Publish/PublishMenu",
    component: PublishMenu,
    parameters: {layout: "centered"},
    args: {onSelect: () => undefined},
} satisfies Meta<typeof PublishMenu>

export default meta
type Story = StoryObj<typeof meta>

export const NothingLive: Story = {
    args: {
        items: [
            {key: "slack", live: false},
            {key: "telegram", live: false},
            {key: "api", live: false},
        ],
    },
}

export const SlackLive: Story = {
    args: {
        items: [
            {key: "slack", live: true},
            {key: "telegram", live: false},
            {key: "api", live: false},
        ],
    },
}

export const TwoPlacesLive: Story = {
    args: {
        items: [
            {key: "slack", live: true},
            {key: "telegram", live: true},
            {key: "api", live: false},
        ],
    },
}

/** Channels loading: Slack and Telegram wait for the connections before they open a drawer. */
export const ChannelsLoading: Story = {
    args: {
        items: [
            {key: "slack", live: false, disabled: true},
            {key: "telegram", live: false, disabled: true},
            {key: "api", live: false},
        ],
    },
}

/** The Channels preference is off: only API is offered. */
export const ChannelsHidden: Story = {
    args: {items: [{key: "api", live: false}]},
}
