import {useRouter} from "next/router"

import {ArchivedAgentListScreen} from "@/features/agents/ArchivedAgentListScreen"

export default function ArchivedAgentsPage() {
    const router = useRouter()
    const workspaceId =
        typeof router.query.workspace_id === "string" ? router.query.workspace_id : ""
    const projectId = typeof router.query.project_id === "string" ? router.query.project_id : ""
    if (!workspaceId || !projectId) return null
    return <ArchivedAgentListScreen workspaceId={workspaceId} projectId={projectId} />
}
