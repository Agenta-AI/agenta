import {useState} from "react"

import type {Meta, StoryObj} from "@storybook/nextjs"

import {EMPTY_CONNECTIONS} from "../channels/helpers"
import {
    AGENT_ID,
    AGENT_NAME,
    SLACK_SETUP,
    TELEGRAM_SETUP,
    createChannelStoryActions,
    renderStoryPanel,
    slackCustomHere,
    slackHere,
    telegramCustomHere,
    telegramElsewhere,
    telegramHere,
    telegramPending,
} from "../channels/storyFixtures"
import type {ChannelConnections} from "../channels/types"

import {AgentPublish} from "./AgentPublish"

/**
 * **The agent header's Publish button and the panel it opens.** The hub shows where the agent
 * answers: one card per platform, and the API. Every view after it opens in the same panel with
 * a back button. The stories wire fake actions over an in-memory fixture.
 */
const meta = {
    title: "@agenta/settings-ui/Publish/AgentPublish",
    component: AgentPublish,
    parameters: {layout: "padded"},
} satisfies Meta<typeof AgentPublish>

export default meta
type Story = StoryObj

const PublishHost = ({
    initial = EMPTY_CONNECTIONS,
    loading = false,
    loadError = null,
}: {
    initial?: ChannelConnections
    loading?: boolean
    loadError?: string | null
}) => {
    const [connections, setConnections] = useState(initial)
    const [{actions}] = useState(() =>
        createChannelStoryActions({
            connections: initial,
            onChange: setConnections,
            setup: {slack: SLACK_SETUP, telegram: TELEGRAM_SETUP},
        }),
    )
    return (
        <div className="flex flex-col items-start gap-4">
            <AgentPublish
                agentId={AGENT_ID}
                agentName={AGENT_NAME}
                projectId="project-story"
                host="https://cloud.agenta.ai"
                connections={connections}
                loading={loading}
                loadError={loadError}
                actions={actions}
                renderPanel={renderStoryPanel}
            />
        </div>
    )
}

/** Nothing connected yet: both platforms offer Connect, and only the API is live. */
export const FirstTime: Story = {render: () => <PublishHost />}

/** Two Slack workspaces and two Telegram bots: expand a card to reach each one. */
export const SeveralConnections: Story = {
    render: () => (
        <PublishHost
            initial={{
                slack: slackHere,
                telegram: telegramHere,
                whatsapp: null,
                agentConnections: {
                    slack: [
                        {...slackHere, workspaceName: "Acme"},
                        {
                            ...slackCustomHere,
                            connectionId: "cx-slack-globex",
                            workspaceName: "Globex",
                            handle: "@support",
                        },
                    ],
                    telegram: [telegramHere, telegramCustomHere],
                    whatsapp: [],
                },
            }}
        />
    ),
}

/** The Agenta bot answers as another agent: Telegram opens the move-or-own-bot choice. */
export const TelegramOnAnotherAgent: Story = {
    render: () => (
        <PublishHost initial={{slack: slackHere, telegram: telegramElsewhere, whatsapp: null}} />
    ),
}

/** A hosted Telegram link was minted but no chat is linked yet. */
export const TelegramPending: Story = {
    render: () => (
        <PublishHost initial={{slack: null, telegram: telegramPending, whatsapp: null}} />
    ),
}

export const Loading: Story = {render: () => <PublishHost loading />}

export const LoadFailed: Story = {
    render: () => <PublishHost loadError="Could not load the channel connections." />,
}
