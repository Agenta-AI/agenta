import {AgentPrivacyPanel} from "@agenta/entity-ui/sharing"
import {AgentChannelsView, NOOP_ACTIONS} from "@agenta/settings-ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {
    agentPagesAgentId,
    agentPagesAgentName,
    channelsSlackConnected,
    channelsSlackRevoked,
    owner,
    privateOwnedSharing,
} from "../../../fixtures/builderLayout/agent-pages"

/** The agent pages' own parts, in the page column width. */
const Frame = ({children}: {children: React.ReactNode}) => (
    <div data-testid="agent-page-story" className="w-[720px] bg-colorBgLayout p-6">
        {children}
    </div>
)

const meta: Meta = {
    title: "BuilderLayout/A06 A07 Agent pages",
    parameters: {layout: "fullscreen"},
}
export default meta

type Story = StoryObj

/** A07: Channels page with Slack connected. */
export const ChannelsConnected: Story = {
    render: () => (
        <Frame>
            <AgentChannelsView
                agentId={agentPagesAgentId}
                agentName={agentPagesAgentName}
                connections={channelsSlackConnected}
                actions={NOOP_ACTIONS}
            />
        </Frame>
    ),
}

/** A07: Slack lost its access: "Needs attention" and "Reconnect". */
export const ChannelsNeedsAttention: Story = {
    render: () => (
        <Frame>
            <AgentChannelsView
                agentId={agentPagesAgentId}
                agentName={agentPagesAgentName}
                connections={channelsSlackRevoked}
                actions={NOOP_ACTIONS}
            />
        </Frame>
    ),
}

/** A06: the Access tab of a private agent, seen by its owner. */
export const AccessPrivateOwner: Story = {
    render: () => (
        <Frame>
            <AgentPrivacyPanel
                active
                agentName={agentPagesAgentName}
                projectName="Acme Agency"
                sharing={privateOwnedSharing}
                disclosure={null}
                owner={owner}
                members={[]}
                membersSearch=""
                onMembersSearch={() => undefined}
                onSetVisibility={async () => "ok"}
                onTransfer={async () => "ok"}
                onTakeOwnership={async () => "ok"}
            />
        </Frame>
    ),
}
