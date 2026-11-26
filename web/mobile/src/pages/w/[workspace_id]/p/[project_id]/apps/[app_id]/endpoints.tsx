import {useRouter} from "next/router"

import {DeveloperViewGate} from "@/features/developer/DeveloperViewGate"
import {EndpointsScreen} from "@/features/endpoints/EndpointsScreen"

/** The app's API endpoint, as in the old app. The screen reads the app from the path. */
export default function AppEndpointsPage() {
    const router = useRouter()
    const read = (key: string) => (typeof router.query[key] === "string" ? router.query[key] : "")
    const workspaceId = read("workspace_id")
    const projectId = read("project_id")
    if (!workspaceId || !projectId || !read("app_id")) return null
    return (
        <DeveloperViewGate viewId="endpoints" betaOnly>
            <EndpointsScreen workspaceId={workspaceId} projectId={projectId} />
        </DeveloperViewGate>
    )
}
