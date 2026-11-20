import {cn} from "@/lib/utils"

import {AgentPrivacyPanelHost} from "../chat/AgentPrivacyHost"

import {useAgentRow} from "./useAgentRow"

/** The Access tab: who can see the agent and who owns it, applied at once. */
export const AccessTab = ({
    agentId,
    workspaceId,
    projectId,
    className,
}: {
    agentId: string
    workspaceId: string
    projectId: string
    className?: string
}) => {
    const {row} = useAgentRow(agentId)
    return (
        <div className={cn("flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4", className)}>
            <AgentPrivacyPanelHost
                agentId={agentId}
                agentName={row?.name || row?.slug || ""}
                workspaceId={workspaceId}
                projectId={projectId}
            />
        </div>
    )
}
