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
    const {workspace_id: workspaceId, project_id: projectId, template} = router.query
    if (typeof workspaceId !== "string" || typeof projectId !== "string") return null
    // Keyed on the template so picking a different card starts a fresh draft rather than leaving
    // the previous seed in place.
    const templateId = typeof template === "string" ? template : undefined
    return (
        <AutomationDraftScreen
            key={templateId ?? "blank"}
            workspaceId={workspaceId}
            projectId={projectId}
            templateId={templateId}
        />
    )
}
