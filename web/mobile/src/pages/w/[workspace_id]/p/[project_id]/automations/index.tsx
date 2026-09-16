import {useRouter} from "next/router"

import {AutomationListScreen} from "@/features/automations/AutomationListScreen"

export default function AutomationsPage() {
    const router = useRouter()
    const {workspace_id: workspaceId, project_id: projectId} = router.query
    if (typeof workspaceId !== "string" || typeof projectId !== "string") return null
    return <AutomationListScreen workspaceId={workspaceId} projectId={projectId} />
}
