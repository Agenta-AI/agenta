import {useRouter} from "next/router"

import {AutomationDraftScreen} from "@/features/automations/AutomationDraftScreen"

/**
 * `/automations/new` — the draft screen.
 *
 * A static segment, so the Pages Router matches it ahead of `[automation_id]`: without this file
 * "new" reads as an id and the detail screen says the automation no longer exists.
 */
export default function AutomationDraftPage() {
    const router = useRouter()
    const {workspace_id: workspaceId, project_id: projectId} = router.query
    if (typeof workspaceId !== "string" || typeof projectId !== "string") return null
    return <AutomationDraftScreen workspaceId={workspaceId} projectId={projectId} />
}
