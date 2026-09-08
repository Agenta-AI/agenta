import {useRouter} from "next/router"

import {AutomationRunsScreen} from "@/features/automations/AutomationRunsScreen"

export default function AutomationRunsPage() {
    const router = useRouter()
    const {
        workspace_id: workspaceId,
        project_id: projectId,
        automation_id: automationId,
    } = router.query
    if (
        typeof workspaceId !== "string" ||
        typeof projectId !== "string" ||
        typeof automationId !== "string"
    ) {
        return null
    }
    return (
        <AutomationRunsScreen
            key={automationId}
            workspaceId={workspaceId}
            projectId={projectId}
            automationId={automationId}
        />
    )
}
