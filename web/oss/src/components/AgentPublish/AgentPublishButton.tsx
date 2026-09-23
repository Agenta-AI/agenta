import {useMemo, useState} from "react"

import {
    PublishMenu,
    buildPublishItems,
    useChannelPanel,
    type PublishTarget,
} from "@agenta/settings-ui"
import {channelsEnabledAtom} from "@agenta/shared/state"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {
    renderChannelsDrawer,
    useAgentChannels,
} from "@/oss/components/pages/overview/agent/useAgentChannels"

const AgentApiContent = dynamic(() => import("./AgentApiContent"), {ssr: false})

interface AgentPublishButtonProps {
    /** The agent (workflow) id. */
    agentId: string
    agentName?: string
    agentDescription?: string | null
}

/**
 * The agent header's Publish button. Slack and Telegram open the same connect and manage
 * drawers as the agent overview's Channels card; API opens the invoke snippets.
 */
const AgentPublishButton = ({agentId, agentName, agentDescription}: AgentPublishButtonProps) => {
    const channelsEnabled = useAtomValue(channelsEnabledAtom)
    const {connections, loading, loadError, actions} = useAgentChannels(agentId, {
        enabled: channelsEnabled,
    })
    const [apiOpen, setApiOpen] = useState(false)

    const channelPanel = useChannelPanel({
        agentId,
        agentName: agentName || undefined,
        agentDescription,
        connections,
        actions,
        renderPanel: renderChannelsDrawer,
    })

    const items = useMemo(
        () =>
            buildPublishItems({
                connections,
                agentId,
                channelsEnabled,
                channelsUnavailable: loading || !!loadError,
            }),
        [connections, agentId, channelsEnabled, loading, loadError],
    )

    const handleSelect = (target: PublishTarget) => {
        if (target === "api") setApiOpen(true)
        else channelPanel.open(target)
    }

    return (
        <>
            <PublishMenu items={items} onSelect={handleSelect} />
            {channelsEnabled ? channelPanel.panel : null}
            <EnhancedDrawer
                open={apiOpen}
                onClose={() => setApiOpen(false)}
                title="API"
                width={720}
                destroyOnHidden
                styles={{body: {padding: 0}}}
            >
                {apiOpen ? <AgentApiContent agentId={agentId} /> : null}
            </EnhancedDrawer>
        </>
    )
}

export default AgentPublishButton
