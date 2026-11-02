import type {Meta, StoryObj} from "@storybook/nextjs"

import {ChannelAgentPicker} from "./ChannelAgentPicker"
import {EMPTY_CONNECTIONS} from "./helpers"
import {AGENT_ID, AGENT_NAME, InlinePanel, OTHER_AGENT} from "./storyFixtures"

/**
 * **Agent sharing in the channel setup.** The agent step says who reads a channel agent's
 * conversations: everyone in the project for a shared agent, only the owner for a private one.
 * Every listed agent can be picked, a private one included.
 */
const meta = {
    title: "@agenta/settings-ui/Channels/Sharing",
    component: ChannelAgentPicker,
    parameters: {layout: "padded"},
} satisfies Meta<typeof ChannelAgentPicker>

export default meta
type Story = StoryObj

const noop = () => undefined

/** Settings > Channels > Slack, the agent step: the audience note and the agents. */
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
                    {id: "private-agent", name: "Recruiting helper"},
                    OTHER_AGENT,
                ]}
                connections={EMPTY_CONNECTIONS}
                onSelect={noop}
                platform="slack"
                projectName="Acme support"
            />
        </InlinePanel>
    ),
}
