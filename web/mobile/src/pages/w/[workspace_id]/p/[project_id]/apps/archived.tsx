import {useRouter} from "next/router"

import {ArchivedAppsScreen} from "@/features/archived-apps/ArchivedAppsScreen"
import {DeveloperViewGate} from "@/features/developer/DeveloperViewGate"

export default function ArchivedAppsPage() {
    const router = useRouter()
    const workspaceId =
        typeof router.query.workspace_id === "string" ? router.query.workspace_id : ""
    const projectId = typeof router.query.project_id === "string" ? router.query.project_id : ""
    if (!workspaceId || !projectId) return null
    return (
        <DeveloperViewGate viewId="archived-apps">
            <ArchivedAppsScreen workspaceId={workspaceId} projectId={projectId} />
        </DeveloperViewGate>
    )
}
