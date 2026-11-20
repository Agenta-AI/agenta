import {useAtomValue} from "jotai"

import {AgentChannelsCard} from "../agents/AgentChannelsCard"
import {useAgentPublishPanel} from "../agents/useAgentPublishPanel"

import {channelsTabSlotAtom} from "./panelSlots"
import {useAgentRow} from "./useAgentRow"

/** The Channels tab: the slot task 23.3 fills, or the production Channels card until then. */
export const ChannelsTab = ({
    agentId,
    workspaceId,
    projectId,
}: {
    agentId: string
    workspaceId: string
    projectId: string
}) => {
    const Slot = useAtomValue(channelsTabSlotAtom)
    if (Slot) return <>{Slot({agentId, workspaceId, projectId})}</>
    return <ProductionChannels agentId={agentId} workspaceId={workspaceId} projectId={projectId} />
}

const ProductionChannels = ({
    agentId,
    workspaceId,
    projectId,
}: {
    agentId: string
    workspaceId: string
    projectId: string
}) => {
    const {row, resolveAgentName} = useAgentRow(agentId)
    const publish = useAgentPublishPanel({
        agentId,
        agentName: row?.name || row?.slug || undefined,
        agentDescription: row?.description?.trim() || null,
        resolveAgentName,
        projectId,
        workspaceId,
    })
    return (
        <div className="h-full min-h-0 overflow-y-auto p-4">
            <AgentChannelsCard
                connections={publish.connections}
                loading={publish.loading}
                loadError={publish.loadError}
                onRetry={() => void publish.reload().catch(() => null)}
                onOpenHub={publish.openHub}
                onOpenConnection={publish.openConnection}
            />
            {publish.panel}
        </div>
    )
}
