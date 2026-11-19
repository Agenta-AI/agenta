import {AgentPrivacyHost} from "../chat/AgentPrivacyHost"

import {useAgentRow} from "./useAgentRow"

/** The Access tab: the production privacy control of the agent. */
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
        <div className="h-full min-h-0 overflow-y-auto p-4">
            <AgentPrivacyHost
                agentId={agentId}
                agentName={row?.name || row?.slug || ""}
                workspaceId={workspaceId}
                projectId={projectId}
            />
        </div>
    )
}
