import {useRouter} from "next/router"

import {PluginListScreen} from "@/features/plugins/PluginListScreen"
export default function PluginsPage() {
    const {query} = useRouter()
    const workspaceId = typeof query.workspace_id === "string" ? query.workspace_id : ""
    const projectId = typeof query.project_id === "string" ? query.project_id : ""
    if (!workspaceId || !projectId) return null
    return <PluginListScreen workspaceId={workspaceId} projectId={projectId} />
}
