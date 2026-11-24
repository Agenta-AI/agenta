import {cn} from "@agenta/ui/styles"
import dynamic from "next/dynamic"

// Loaded when the tab first opens: the channel views are not part of the session screen.
const AgentChannels = dynamic(() =>
    import("../agent-pages/AgentChannels").then((m) => m.AgentChannels),
)

/** The Channels tab of the agent's right panel: the same view as the agent's Channels page. */
export const ChannelsTab = ({
    agentId,
    workspaceId,
    projectId,
    className,
}: {
    agentId: string
    workspaceId: string
    projectId: string
    className?: string
}) => (
    <div className={cn("h-full min-h-0 overflow-y-auto p-4", className)}>
        <AgentChannels agentId={agentId} workspaceId={workspaceId} projectId={projectId} />
    </div>
)
