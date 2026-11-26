import {getChannelsClient} from "@agenta/sdk/resources"
import {
    AgentApiPanel,
    AgentEmbedPanel,
    agentHostFromApiUrl,
    type EmbedViewProps,
} from "@agenta/settings-ui"
import {useRouter} from "next/router"

import {getApiUrl} from "@/lib/env"

/**
 * The API and Embed views of an agent, as the Publish panel and the agent's Channels view show
 * them: how to call the agent over HTTP, and the chat widget for a website.
 */
export const useAgentPublishViews = ({
    agentId,
    agentName,
    projectId,
    workspaceId,
}: {
    agentId: string
    agentName?: string
    projectId: string
    workspaceId: string
}) => {
    const {basePath} = useRouter()
    return {
        api: (
            <AgentApiPanel
                agentId={agentId}
                projectId={projectId}
                workspaceId={workspaceId}
                host={agentHostFromApiUrl(getApiUrl())}
            />
        ),
        embed: (view: EmbedViewProps) => (
            <AgentEmbedPanel
                {...view}
                client={getChannelsClient()}
                projectId={projectId}
                agentId={agentId}
                agentName={agentName}
                widgetUrl={(embedId) => `${window.location.origin}${basePath}/embed/${embedId}`}
            />
        ),
    }
}
