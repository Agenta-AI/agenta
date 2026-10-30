import {useRouter} from "next/router"

import {PluginScreen} from "@/features/plugins/PluginScreen"
export default function PluginsPage() {
    const {query} = useRouter()
    const workspaceId = typeof query.workspace_id === "string" ? query.workspace_id : ""
    const projectId = typeof query.project_id === "string" ? query.project_id : ""
    const pluginId = typeof query.plugin_id === "string" ? query.plugin_id : ""
    if (!workspaceId || !projectId || !pluginId) return null
    return <PluginScreen workspaceId={workspaceId} projectId={projectId} pluginId={pluginId} />
}
