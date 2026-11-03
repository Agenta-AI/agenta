import {useRouter} from "next/router"

import {DeveloperViewGate} from "@/features/developer/DeveloperViewGate"
import {EndpointsScreen} from "@/features/endpoints/EndpointsScreen"

export default function EndpointsPage() {
    const router = useRouter()
    const workspaceId =
        typeof router.query.workspace_id === "string" ? router.query.workspace_id : ""
    const projectId = typeof router.query.project_id === "string" ? router.query.project_id : ""
    if (!workspaceId || !projectId) return null
    return (
        <DeveloperViewGate viewId="endpoints">
            <EndpointsScreen workspaceId={workspaceId} projectId={projectId} />
        </DeveloperViewGate>
    )
}
