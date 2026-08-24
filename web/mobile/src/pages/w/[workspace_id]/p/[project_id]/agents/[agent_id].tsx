import {useRouter} from "next/router"

import {AgentOverviewScreen} from "@/features/agents/AgentOverviewScreen"

export default function AgentOverviewPage() {
    const router = useRouter()
    const {workspace_id: workspaceId, project_id: projectId, agent_id: agentId} = router.query
    if (
        typeof workspaceId !== "string" ||
        typeof projectId !== "string" ||
        typeof agentId !== "string"
    ) {
        return null
    }
    return (
        <AgentOverviewScreen
            key={agentId}
            workspaceId={workspaceId}
            projectId={projectId}
            agentId={agentId}
        />
    )
}
