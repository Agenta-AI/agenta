import {useRouter} from "next/router"

import {AutomationDetailScreen} from "@/features/automations/AutomationDetailScreen"

export default function AutomationDetailPage() {
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
        <AutomationDetailScreen
            key={automationId}
            workspaceId={workspaceId}
            projectId={projectId}
            automationId={automationId}
        />
    )
}
