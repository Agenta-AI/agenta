import type {ChannelConnections, ChannelsActions} from "../channels/types"
import {useChannelPanel, type ChannelsPanelRenderProps} from "../channels/useChannelPanel"

import {AgentApiPanel} from "./AgentApiPanel"
import {PublishButton} from "./PublishButton"

export interface AgentPublishProps {
    agentId: string
    agentName?: string
    /** Seeds the description of a new Slack app. */
    agentDescription?: string | null
    projectId: string
    workspaceId?: string | null
    /** The Agenta origin, without `/api`, that the API snippets call. */
    host: string
    /** The project's channel connections and the real actions on them, loaded by the host. */
    connections: ChannelConnections
    loading?: boolean
    loadError?: string | null
    actions: ChannelsActions
    /** Host-provided sliding container for the Publish panel: a drawer on /w, a sheet on /m. */
    renderPanel: (props: ChannelsPanelRenderProps) => React.ReactNode
}

/**
 * The agent header's Publish control: the button and the panel it opens, with the hub of
 * places the agent answers (Slack, Telegram, WhatsApp, API).
 */
export const AgentPublish = ({
    agentId,
    agentName,
    agentDescription,
    projectId,
    workspaceId,
    host,
    connections,
    loading = false,
    loadError = null,
    actions,
    renderPanel,
}: AgentPublishProps) => {
    const panel = useChannelPanel({
        agentId,
        agentName,
        agentDescription,
        connections,
        loading,
        loadError,
        actions,
        renderPanel,
        api: (
            <AgentApiPanel
                agentId={agentId}
                projectId={projectId}
                workspaceId={workspaceId}
                host={host}
            />
        ),
    })

    return (
        <>
            <PublishButton onClick={() => panel.openRoute({view: "hub"})} />
            {panel.panel}
        </>
    )
}
