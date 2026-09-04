import {useRouter} from "next/router"

import {AgentListScreen} from "@/features/agents/AgentListScreen"

export default function AgentsPage() {
    const router = useRouter()
    const workspaceId =
        typeof router.query.workspace_id === "string" ? router.query.workspace_id : ""
    const projectId = typeof router.query.project_id === "string" ? router.query.project_id : ""
    if (!workspaceId || !projectId) return null
    return <AgentListScreen workspaceId={workspaceId} projectId={projectId} />
}
