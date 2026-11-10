import {useRouter} from "next/router"

import {DeveloperViewGate} from "@/features/developer/DeveloperViewGate"
import {useAppPageRedirect} from "@/features/developer/useAppPageRedirect"
import {EndpointsScreen} from "@/features/endpoints/EndpointsScreen"

export default function EndpointsPage() {
    const router = useRouter()
    const moving = useAppPageRedirect("endpoints")
    const workspaceId =
        typeof router.query.workspace_id === "string" ? router.query.workspace_id : ""
    const projectId = typeof router.query.project_id === "string" ? router.query.project_id : ""
    if (!workspaceId || !projectId || moving) return null
    return (
        <DeveloperViewGate viewId="endpoints">
            <EndpointsScreen workspaceId={workspaceId} projectId={projectId} />
        </DeveloperViewGate>
    )
}
