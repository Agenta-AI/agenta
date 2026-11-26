import {useRouter} from "next/router"

import {DeveloperViewGate} from "@/features/developer/DeveloperViewGate"
import {ObservabilityScreen} from "@/features/observability/ObservabilityScreen"

/** The app's traces, as in the old app. The screen reads the app from the path. */
export default function AppTracesPage() {
    const router = useRouter()
    const read = (key: string) => (typeof router.query[key] === "string" ? router.query[key] : "")
    const workspaceId = read("workspace_id")
    const projectId = read("project_id")
    if (!workspaceId || !projectId || !read("app_id")) return null
    return (
        <DeveloperViewGate viewId="observability-app-filter" betaOnly>
            <ObservabilityScreen workspaceId={workspaceId} projectId={projectId} />
        </DeveloperViewGate>
    )
}
