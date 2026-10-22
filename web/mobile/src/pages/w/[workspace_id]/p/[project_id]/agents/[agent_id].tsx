import {useRouter} from "next/router"

import {isAgentOverviewEnabled, OPEN_PLAYGROUND} from "@/features/agents/agentEntry"
import {AgentOverviewScreen} from "@/features/agents/AgentOverviewScreen"
import {AgentPlaygroundRedirect} from "@/features/agents/AgentPlaygroundRedirect"

export default function AgentOverviewPage() {
    const router = useRouter()
    const {workspace_id: workspaceId, project_id: projectId, agent_id: agentId, open} = router.query
    if (
        typeof workspaceId !== "string" ||
        typeof projectId !== "string" ||
        typeof agentId !== "string"
    ) {
        return null
    }
    // A typed URL (no `?open=`) still reaches the overview with the flag off.
    if (open === OPEN_PLAYGROUND && !isAgentOverviewEnabled()) {
        return (
            <AgentPlaygroundRedirect base={`/w/${workspaceId}/p/${projectId}`} agentId={agentId} />
        )
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
