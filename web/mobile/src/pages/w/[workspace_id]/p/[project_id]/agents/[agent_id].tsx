import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {isAgentOverviewEnabled, OPEN_PLAYGROUND} from "@/features/agents/agentEntry"
import {AgentOverviewScreen} from "@/features/agents/AgentOverviewScreen"
import {AgentPlaygroundRedirect} from "@/features/agents/AgentPlaygroundRedirect"

// The agent pages load only when opened, so the agent route stays as light as it was.
const AgentSessionsPage = dynamic(() =>
    import("@/features/sessions/SessionListScreen").then((m) => m.SessionListScreen),
)
const AgentAnalyticsPage = dynamic(() =>
    import("@/features/agent-pages/AgentAnalyticsScreen").then((m) => m.AgentAnalyticsScreen),
)

export default function AgentOverviewPage() {
    const router = useRouter()
    const {
        workspace_id: workspaceId,
        project_id: projectId,
        agent_id: agentId,
        open,
        view,
    } = router.query
    if (
        typeof workspaceId !== "string" ||
        typeof projectId !== "string" ||
        typeof agentId !== "string"
    ) {
        return null
    }
    // The agent pages are views of this route (`?view=`). Keyed by agent: each agent's page has
    // its own filters.
    if (view === "sessions")
        return (
            <AgentSessionsPage
                key={agentId}
                workspaceId={workspaceId}
                projectId={projectId}
                agentId={agentId}
            />
        )
    if (view === "analytics")
        return (
            <AgentAnalyticsPage
                key={agentId}
                workspaceId={workspaceId}
                projectId={projectId}
                agentId={agentId}
            />
        )
    const overview = (
        <AgentOverviewScreen
            key={agentId}
            workspaceId={workspaceId}
            projectId={projectId}
            agentId={agentId}
        />
    )
    // A typed URL (no `?open=`) still reaches the overview with the flag off.
    if (open === OPEN_PLAYGROUND && !isAgentOverviewEnabled()) {
        return (
            <AgentPlaygroundRedirect
                base={`/w/${workspaceId}/p/${projectId}`}
                agentId={agentId}
                fallback={overview}
            />
        )
    }
    return overview
}
