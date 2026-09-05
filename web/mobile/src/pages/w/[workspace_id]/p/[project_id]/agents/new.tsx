import {useRouter} from "next/router"

import {NewAgentScreen} from "@/features/agents/NewAgentScreen"

export default function NewAgentPage() {
    const router = useRouter()
    const workspaceId =
        typeof router.query.workspace_id === "string" ? router.query.workspace_id : ""
    const projectId = typeof router.query.project_id === "string" ? router.query.project_id : ""
    const templateKey =
        typeof router.query.template === "string" && router.query.template
            ? router.query.template
            : undefined
    if (!workspaceId || !projectId) return null
    return (
        <NewAgentScreen workspaceId={workspaceId} projectId={projectId} templateKey={templateKey} />
    )
}
