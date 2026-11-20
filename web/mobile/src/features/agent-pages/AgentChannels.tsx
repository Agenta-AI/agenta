import {AgentChannelsView} from "@agenta/settings-ui"

import {useAgentRow} from "../agent-layout/useAgentRow"
import {useAgentChannels} from "../agents/useAgentChannels"

/**
 * The Channels view of one agent, connected to its channels. The Channels page and the Channels
 * tab of the agent's right panel both mount it.
 */
export const AgentChannels = ({agentId}: {agentId: string}) => {
    const {row, resolveAgentName} = useAgentRow(agentId)
    // Undefined until the agent list loads: the views then say "your agent", not a blank.
    const agentName = row?.name || row?.slug || undefined
    const {connections, loading, loadError, actions} = useAgentChannels(agentId, {
        resolveAgentName,
    })
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
        />
    )
}
