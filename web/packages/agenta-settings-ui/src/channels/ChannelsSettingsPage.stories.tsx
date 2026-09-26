import {useState} from "react"

import type {Meta, StoryObj} from "@storybook/nextjs"

import {connectionsForAgent} from "./actions"
import {ChannelsSettingsPage} from "./ChannelsSettingsPage"
import {
    AGENT_ID,
    AGENT_NAME,
    OTHER_AGENT,
    SLACK_SETUP,
    TELEGRAM_SETUP,
    createChannelStoryActions,
    renderStoryPanel,
    slackHere,
    slackRevoked,
    telegramCustomHere,
    telegramElsewhere,
    telegramPending,
} from "./storyFixtures"
import type {ChannelConnection} from "./types"

/**
 * **Settings > Channels.** Every connection in the project as a card, whichever agent it
 * answers as. A card opens the Publish panel on its connection; a new connection starts by
 * choosing the agent. The stories wire fake actions over an in-memory fixture.
 */
const meta = {
    title: "@agenta/settings-ui/Channels/ChannelsSettingsPage",
    component: ChannelsSettingsPage,
    parameters: {layout: "padded"},
} satisfies Meta<typeof ChannelsSettingsPage>

export default meta
type Story = StoryObj

const AGENTS = [{id: AGENT_ID, name: AGENT_NAME}, OTHER_AGENT]

const SettingsHost = ({
    rows,
    agents = AGENTS,
    loading = false,
    loadError = null,
}: {
    rows: ChannelConnection[] | null
    agents?: typeof AGENTS
    loading?: boolean
    loadError?: string | null
}) => {
    const [agentId, setAgentId] = useState(agents[0]?.id)
    const [{actions}] = useState(() =>
        createChannelStoryActions({setup: {slack: SLACK_SETUP, telegram: TELEGRAM_SETUP}}),
    )
    return (
        <div className="w-full max-w-[1120px]">
            <ChannelsSettingsPage
                agents={agents}
                agentId={agentId}
                onAgentChange={setAgentId}
                connections={
                    rows
                        ? connectionsForAgent(rows, agentId ?? "")
                        : {slack: null, telegram: null, whatsapp: null}
                }
                loading={loading}
                loadError={loadError}
                onRetry={async () => undefined}
                actions={actions}
                renderPanel={renderStoryPanel}
            />
        </div>
    )
}

export const Connections: Story = {
    render: () => (
        <SettingsHost
            rows={[
                slackHere,
                {...telegramElsewhere, connectionId: "cx-telegram-other"},
                telegramCustomHere,
            ]}
        />
    ),
}

/** Every state a card can carry: live, broken, not linked yet, and answering as no agent. */
export const CardStates: Story = {
    render: () => (
        <SettingsHost
            rows={[
                slackHere,
                {...slackRevoked, connectionId: "cx-slack-revoked"},
                {...telegramPending, connectionId: "cx-telegram-pending"},
                {...telegramCustomHere, connectionId: "cx-telegram-orphan", agent: null},
            ]}
        />
    ),
}

export const Empty: Story = {
    render: () => <SettingsHost rows={[]} />,
}

/** With no agents, New connection's picker says to create one first. */
export const NoAgents: Story = {
    render: () => <SettingsHost rows={[]} agents={[]} />,
}

export const Loading: Story = {
    render: () => <SettingsHost rows={null} loading />,
}

export const LoadError: Story = {
    render: () => <SettingsHost rows={null} loadError="Could not load Channels. Try again." />,
}
