import {useCallback, useMemo} from "react"

import {agentWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {AgentPublish, agentHostFromApiUrl, type ChannelsPanelRenderProps} from "@agenta/settings-ui"
import {useAtomValue} from "jotai"

import {getApiUrl} from "@/lib/env"

import {ChannelsPanelSheet} from "./ChannelsPanelSheet"
import {useAgentChannels} from "./useAgentChannels"

/**
 * The /m session workspace header's Publish control: the shared `AgentPublish`, fed this app's
 * channel connections and its sheet. The /w playground header renders the same one.
 */
export const AgentPublishButton = ({
    agentId,
    workspaceId,
    projectId,
}: {
    agentId: string
    workspaceId: string
    projectId: string
}) => {
    // The roster names the agent a connection answers as, and seeds a new Slack app's text.
    const agentsQuery = useAtomValue(agentWorkflowsListQueryStateAtom)
    const agent = useMemo(
        () => (agentsQuery.data ?? []).find((candidate) => candidate.id === agentId),
        [agentsQuery.data, agentId],
    )
    const resolveAgentName = useCallback(
        (id: string) => {
            const match = (agentsQuery.data ?? []).find((candidate) => candidate.id === id)
            return match ? match.name || match.slug || "Agent" : null
        },
        [agentsQuery.data],
    )

    const {connections, loading, loadError, actions} = useAgentChannels(agentId, {
        resolveAgentName,
    })

    return (
        <AgentPublish
            agentId={agentId}
            agentName={agent?.name || agent?.slug || undefined}
            agentDescription={agent?.description?.trim() || null}
            projectId={projectId}
            workspaceId={workspaceId}
            host={agentHostFromApiUrl(getApiUrl())}
            connections={connections}
            loading={loading}
            loadError={loadError}
            actions={actions}
            renderPanel={(props: ChannelsPanelRenderProps) => <ChannelsPanelSheet {...props} />}
        />
    )
}
