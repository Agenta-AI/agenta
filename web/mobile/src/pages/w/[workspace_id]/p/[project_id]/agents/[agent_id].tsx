import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {AgentPageBuilderHost} from "@/features/agent-layout/AgentPageBuilderHost"
import {isConfigurationTab} from "@/features/agent-pages/configurationTabs"
import {isAgentOverviewEnabled, OPEN_PLAYGROUND} from "@/features/agents/agentEntry"
import {AgentOverviewScreen} from "@/features/agents/AgentOverviewScreen"
import {AgentPlaygroundRedirect} from "@/features/agents/AgentPlaygroundRedirect"
import {SessionsPageSkeleton} from "@/features/sessions/states/SessionsPageSkeleton"

// The agent pages load only when opened, so the agent route stays as light as it was.
// The page frame shows while a chunk loads, not a blank body.
const AgentSessionsPage = dynamic(
    () => import("@/features/sessions/SessionListScreen").then((m) => m.SessionListScreen),
    {loading: () => <SessionsPageSkeleton />},
)
const AgentChannelsPage = dynamic(
    () => import("@/features/agent-pages/AgentChannelsScreen").then((m) => m.AgentChannelsScreen),
    {loading: () => <SessionsPageSkeleton />},
)
const AgentConfigurationPage = dynamic(
    () =>
        import("@/features/agent-pages/AgentConfigurationScreen").then(
            (m) => m.AgentConfigurationScreen,
        ),
    {loading: () => <SessionsPageSkeleton />},
)
const AgentAnalyticsPage = dynamic(
    () => import("@/features/agent-pages/AgentAnalyticsScreen").then((m) => m.AgentAnalyticsScreen),
    {loading: () => <SessionsPageSkeleton />},
)

export default function AgentOverviewPage() {
    const router = useRouter()
    const {
        workspace_id: workspaceId,
        project_id: projectId,
        agent_id: agentId,
        open,
        view,
        tab,
    } = router.query
    if (
        typeof workspaceId !== "string" ||
        typeof projectId !== "string" ||
        typeof agentId !== "string"
    ) {
        return null
    }
    // The agent pages are views of this route (`?view=`). Keyed by agent: each agent's page has
    // its own filters. One builder host holds all four, so the builder panel stays mounted on a
    // move between them.
    const page =
        view === "configuration" ? (
            <AgentConfigurationPage
                key={agentId}
                workspaceId={workspaceId}
                projectId={projectId}
                agentId={agentId}
                // The Agent tab by default, and for an unknown tab.
                tab={isConfigurationTab(tab) ? tab : "agent"}
            />
        ) : view === "sessions" ? (
            <AgentSessionsPage
                key={agentId}
                workspaceId={workspaceId}
                projectId={projectId}
                lockedAgentId={agentId}
            />
        ) : view === "channels" ? (
            <AgentChannelsPage
                key={agentId}
                workspaceId={workspaceId}
                projectId={projectId}
                agentId={agentId}
            />
        ) : view === "analytics" ? (
            <AgentAnalyticsPage
                key={agentId}
                workspaceId={workspaceId}
                projectId={projectId}
                agentId={agentId}
            />
        ) : null
    if (page)
        return (
            <AgentPageBuilderHost
                key={agentId}
                agentId={agentId}
                workspaceId={workspaceId}
                projectId={projectId}
            >
                {page}
            </AgentPageBuilderHost>
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
