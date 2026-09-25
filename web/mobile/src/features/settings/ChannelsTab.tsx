import {useCallback, useMemo, useState} from "react"

import {agentWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {ChannelsSettingsPage, type ChannelsPanelRenderProps} from "@agenta/settings-ui"
import {useAtomValue} from "jotai"

import {ChannelsPanelSheet} from "../agents/ChannelsPanelSheet"
import {useAgentChannels} from "../agents/useAgentChannels"

/**
 * Settings > Channels: every connection in the project. The panel acts for one agent at a
 * time, so the channels actions are rebuilt whenever the user picks another.
 */
export const ChannelsTab = () => {
    const agentsQuery = useAtomValue(agentWorkflowsListQueryStateAtom)
    const agents = useMemo(
        () =>
            (agentsQuery.data ?? []).map((agent) => ({
                id: agent.id,
                name: agent.name || agent.slug || "Agent",
                description: agent.description?.trim() || null,
            })),
        [agentsQuery.data],
    )
    const resolveAgentName = useCallback(
        (id: string) => agents.find((agent) => agent.id === id)?.name ?? null,
        [agents],
    )

    const [picked, setPicked] = useState<string | null>(null)
    const agent = agents.find((candidate) => candidate.id === picked) ?? agents[0]

    // The roster landing rebuilds the actions, so the reload that follows names every agent.
    const {connections, loading, loadError, actions} = useAgentChannels(agent?.id ?? "", {
        resolveAgentName,
    })

    return (
        <ChannelsSettingsPage
            agents={agents}
            agentId={agent?.id}
            onAgentChange={setPicked}
            agentDescription={agent?.description}
            connections={connections}
            loading={loading}
            loadError={loadError}
            onRetry={() => actions.reload().then(() => undefined)}
            actions={actions}
            renderPanel={(props: ChannelsPanelRenderProps) => <ChannelsPanelSheet {...props} />}
        />
    )
}
