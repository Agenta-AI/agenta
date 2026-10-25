import type {Meta, StoryObj} from "@storybook/nextjs"

import {ChannelAgentPicker} from "./ChannelAgentPicker"
import {ChannelsHubView} from "./ChannelsHubView"
import {EMPTY_CONNECTIONS} from "./helpers"
import {AGENT_ID, AGENT_NAME, InlinePanel, OTHER_AGENT} from "./storyFixtures"

/**
 * **Agent sharing in the channel setup.** Everyone in the project can read a channel agent's
 * conversations, so the agent step says so. A private agent cannot answer a channel: the
 * reader's own private agents are listed last and cannot be picked, and an agent's own Publish
 * panel shows a note in place of the connect buttons. Both link to "Privacy and owner".
 */
const meta = {
    title: "@agenta/settings-ui/Channels/Sharing",
    component: ChannelAgentPicker,
    parameters: {layout: "padded"},
} satisfies Meta<typeof ChannelAgentPicker>

export default meta
type Story = StoryObj

const noop = () => undefined

/** Settings > Channels > Slack, the agent step: the audience note and a private agent. */
export const AgentStep: Story = {
    render: () => (
        <InlinePanel
            title="Connect a channel"
            subtitle="Choose the agent that answers"
            onClose={noop}
        >
            <ChannelAgentPicker
                agents={[
                    {id: AGENT_ID, name: AGENT_NAME},
                    {id: "private-agent", name: "Recruiting helper", isPrivate: true},
                    OTHER_AGENT,
                ]}
                connections={EMPTY_CONNECTIONS}
                onSelect={noop}
                platform="slack"
                projectName="Acme support"
                onShareAgent={noop}
            />
        </InlinePanel>
    ),
}

/** The Publish panel of a private agent: the note takes the place of the connect buttons. */
export const PublishPrivateAgent: Story = {
    render: () => (
        <InlinePanel title="Publish" subtitle={AGENT_NAME} onClose={noop}>
            <ChannelsHubView
                agentId={AGENT_ID}
                connections={EMPTY_CONNECTIONS}
                onRetry={async () => undefined}
                showApi
                apiLive
                onOpenPlatform={noop}
                onOpenConnection={noop}
                onAdd={noop}
                onOpenApi={noop}
                agentPrivate
                onShareAgent={noop}
            />
        </InlinePanel>
    ),
}
