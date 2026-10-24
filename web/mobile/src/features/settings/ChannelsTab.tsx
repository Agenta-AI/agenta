import {useCallback, useMemo, useState} from "react"

import {agentWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {
    ChannelsPanelSheet,
    ChannelsSettingsPage,
    type ChannelsPanelRenderProps,
} from "@agenta/settings-ui"
import {userAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"

import {isMyPrivateAgent} from "../agents/myPrivateAgent"
import {useAgentChannels} from "../agents/useAgentChannels"
import {AgentPrivacyDialogHost} from "../chat/AgentPrivacyHost"
import {useCurrentProject} from "../context/useCurrentProject"

import type {SettingsTabProps} from "./settingsTabProps"
import {useConfirmModal} from "./useConfirmModal"

/**
 * Settings > Channels: every connection in the project. The panel acts for one agent at a
 * time, so the channels actions are rebuilt whenever the user picks another.
 */
export const ChannelsTab = ({workspaceId, projectId}: SettingsTabProps) => {
    const {confirm, modal: confirmModal} = useConfirmModal()
    const project = useCurrentProject(workspaceId, projectId)
    const me = useAtomValue(userAtom)
    const agentsQuery = useAtomValue(agentWorkflowsListQueryStateAtom)
    const agents = useMemo(
        () =>
            (agentsQuery.data ?? [])
                // Others' private agents never show; the server list already hides them.
                .filter(
                    (agent) =>
                        agent.access?.visibility !== "private" || isMyPrivateAgent(agent, me?.id),
                )
                .map((agent) => ({
                    id: agent.id,
                    name: agent.name || agent.slug || "Agent",
                    description: agent.description?.trim() || null,
                    isPrivate: isMyPrivateAgent(agent, me?.id),
                })),
        [agentsQuery.data, me?.id],
    )
    const resolveAgentName = useCallback(
        (id: string) => agents.find((agent) => agent.id === id)?.name ?? null,
        [agents],
    )

    const [picked, setPicked] = useState<string | null>(null)
    const agent = agents.find((candidate) => candidate.id === picked) ?? agents[0]
    // The agent whose "Privacy and owner" a Share link opened.
    const [sharing, setSharing] = useState<string | null>(null)
    const sharingAgent = agents.find((candidate) => candidate.id === sharing)

    // The roster landing rebuilds the actions, so the reload that follows names every agent.
    const {connections, loading, loadError, actions} = useAgentChannels(agent?.id ?? "", {
        resolveAgentName,
    })

    return (
        <>
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
                confirm={confirm}
                projectName={project?.project_name}
                onShareAgent={setSharing}
            />
            {sharingAgent ? (
                <AgentPrivacyDialogHost
                    agentId={sharingAgent.id}
                    agentName={sharingAgent.name}
                    workspaceId={workspaceId}
                    projectId={projectId}
                    connections={sharingAgent.id === agent?.id ? connections : undefined}
                    // Make-private and share-again change which bindings are on.
                    onChanged={() => void actions.reload().catch(() => null)}
                    onClose={() => setSharing(null)}
                />
            ) : null}
            {confirmModal}
        </>
    )
}
