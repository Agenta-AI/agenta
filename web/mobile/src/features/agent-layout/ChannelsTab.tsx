import dynamic from "next/dynamic"

// Loaded when the tab first opens: the channel views are not part of the session screen.
const AgentChannels = dynamic(() =>
    import("../agent-pages/AgentChannels").then((m) => m.AgentChannels),
)

/** The Channels tab of Configuration: the same view as the agent's Channels page (task 23.3). */
export const ChannelsTab = ({
    agentId,
}: {
    agentId: string
    workspaceId: string
    projectId: string
}) => (
    <div className="h-full min-h-0 overflow-y-auto p-4">
        <AgentChannels agentId={agentId} />
    </div>
)
