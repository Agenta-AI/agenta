import {useCallback} from "react"

import {
    AgentApiPanel,
    agentHostFromApiUrl,
    useChannelPanel,
    type ChannelsPanelRenderProps,
} from "@agenta/settings-ui"

import {getApiUrl} from "@/lib/env"

import {ChannelsPanelSheet} from "./ChannelsPanelSheet"
import {useAgentChannels} from "./useAgentChannels"

/**
 * The agent overview's Publish panel and the channel connections behind it. Owned by the screen,
 * so the rail's Channels card and the phone's kebab open the same panel.
 */
export const useAgentPublishPanel = ({
    agentId,
    agentName,
    agentDescription,
    resolveAgentName,
    projectId,
    workspaceId,
}: {
    agentId: string
    agentName?: string
    /** Seeds the description of a new Slack app. */
    agentDescription?: string | null
    /** Resolve an agent id to its display name; null when the roster does not hold it. */
    resolveAgentName?: (id: string) => string | null
    projectId: string
    workspaceId: string
}) => {
    const {connections, loading, loadError, actions} = useAgentChannels(agentId, {
        resolveAgentName,
    })
    const panel = useChannelPanel({
        agentId,
        agentName,
        agentDescription,
        connections,
        loading,
        loadError,
        actions,
        renderPanel: (props: ChannelsPanelRenderProps) => <ChannelsPanelSheet {...props} />,
        // The same hub the header's Publish opens, API included.
        api: (
            <AgentApiPanel
                agentId={agentId}
                projectId={projectId}
                workspaceId={workspaceId}
                host={agentHostFromApiUrl(getApiUrl())}
            />
        ),
    })
    const {openRoute, openConnection} = panel
    const openHub = useCallback(() => openRoute({view: "hub"}), [openRoute])
    return {
        connections,
        loading,
        loadError,
        reload: actions.reload,
        openHub,
        openConnection,
        panel: panel.panel,
    }
}
