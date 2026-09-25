import {ChannelsPage, type ChannelsPanelRenderProps} from "@agenta/settings-ui"

import {ChannelsPanelSheet} from "./ChannelsPanelSheet"
import {useAgentChannels} from "./useAgentChannels"

/**
 * The agent page's Channels section on /m: the shared designed screen, wired to the real
 * channels API through `buildAgentChannelsActions`, in a bottom sheet.
 *
 * Same logic as the desktop host (`web/oss/.../overview/agent/AgentChannelsCard`); only the
 * panel container and the agent-name lookup differ.
 */
export const AgentChannelsCard = ({
    appId,
    agentName,
    agentDescription,
    resolveAgentName,
}: {
    appId: string
    agentName?: string
    /** Seeds the description of a new Slack app. */
    agentDescription?: string | null
    /** Resolve an agent id to its display name; null when the roster does not hold it. */
    resolveAgentName?: (id: string) => string | null
}) => {
    const {connections, loading, loadError, actions} = useAgentChannels(appId, {
        resolveAgentName,
    })

    return (
        <ChannelsPage
            agentId={appId}
            agentName={agentName}
            agentDescription={agentDescription}
            connections={connections}
            loading={loading}
            loadError={loadError}
            onRetry={() => actions.reload().then(() => undefined)}
            actions={actions}
            renderPanel={(props: ChannelsPanelRenderProps) => <ChannelsPanelSheet {...props} />}
        />
    )
}

export default AgentChannelsCard
