import type {ReactNode} from "react"

import {AgentChannelsView, type ChannelsPanelRenderProps} from "@agenta/settings-ui"

import {useAgentRow} from "../agent-layout/useAgentRow"
import {useAgentChannels} from "../agents/useAgentChannels"
import {useAgentPublishViews} from "../agents/useAgentPublishViews"

/**
 * The Channels view of one agent, connected to its channels. The Channels page and the Channels
 * tab of the agent's right panel both mount it. API and Embed open the same views as Publish.
 */
export const AgentChannels = ({
    agentId,
    workspaceId,
    projectId,
    renderOpenView,
}: {
    agentId: string
    workspaceId: string
    projectId: string
    /** The right pane draws an open channel view under its own back link. */
    renderOpenView?: (view: ChannelsPanelRenderProps) => ReactNode
}) => {
    const {row, resolveAgentName} = useAgentRow(agentId)
    // Undefined until the agent list loads: the views then say "your agent", not a blank.
    const agentName = row?.name || row?.slug || undefined
    const {connections, loading, loadError, actions} = useAgentChannels(agentId, {
        resolveAgentName,
    })
    const {api, embed} = useAgentPublishViews({agentId, agentName, projectId, workspaceId})
    return (
        <AgentChannelsView
            key={agentId}
            agentId={agentId}
            agentName={agentName}
            agentDescription={row?.description?.trim() || null}
            connections={connections}
            loading={loading}
            loadError={loadError}
            actions={actions}
            api={api}
            embed={embed}
            renderOpenView={renderOpenView}
        />
    )
}
