import {ChannelsPage} from "@agenta/settings-ui"

import {renderChannelsDrawer, useAgentChannels} from "./useAgentChannels"

/**
 * The agent page's Channels section on desktop: the shared designed screen, wired to the
 * real channels API through `buildAgentChannelsActions`, in an antd Drawer.
 */
const AgentChannelsCard = ({
    appId,
    agentName,
    agentDescription,
}: {
    appId: string
    agentName?: string
    agentDescription?: string | null
}) => {
    const {connections, loading, loadError, actions} = useAgentChannels(appId)

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
            renderPanel={renderChannelsDrawer}
        />
    )
}

export default AgentChannelsCard
