import {useRouter} from "next/router"

import {SettingsScreen} from "@/features/settings/SettingsScreen"

export default function SettingsPage() {
    const router = useRouter()
    const workspaceId =
        typeof router.query.workspace_id === "string" ? router.query.workspace_id : ""
    const projectId = typeof router.query.project_id === "string" ? router.query.project_id : ""
    if (!workspaceId || !projectId) return null
    return <SettingsScreen workspaceId={workspaceId} projectId={projectId} />
}
