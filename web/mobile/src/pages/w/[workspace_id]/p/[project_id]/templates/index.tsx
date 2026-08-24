import {useRouter} from "next/router"

import {AgentTemplatesScreen} from "@/features/agents/AgentTemplatesScreen"

export default function AgentTemplatesPage() {
    const router = useRouter()
    const {workspace_id: workspaceId, project_id: projectId} = router.query
    if (typeof workspaceId !== "string" || typeof projectId !== "string") return null
    return <AgentTemplatesScreen workspaceId={workspaceId} projectId={projectId} />
}
