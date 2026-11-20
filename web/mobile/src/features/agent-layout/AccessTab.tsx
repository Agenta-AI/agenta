import {AgentPrivacyPanelHost} from "../chat/AgentPrivacyHost"

import {useAgentRow} from "./useAgentRow"

/** The Access tab: who can see the agent and who owns it, applied at once. */
export const AccessTab = ({
    agentId,
    workspaceId,
    projectId,
}: {
    agentId: string
    workspaceId: string
    projectId: string
}) => {
    const {row} = useAgentRow(agentId)
    return (
        <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
            <AgentPrivacyPanelHost
                agentId={agentId}
                agentName={row?.name || row?.slug || ""}
                workspaceId={workspaceId}
                projectId={projectId}
            />
        </div>
    )
}
