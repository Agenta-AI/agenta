import {useRouter} from "next/router"

import {DeveloperViewGate} from "@/features/developer/DeveloperViewGate"
import {EvaluationsRoute} from "@/features/evaluations/new/EvaluationsRoute"

/** The app's evaluation runs, as in the old app. The screen reads the app from the path. */
export default function AppEvaluationsPage() {
    const router = useRouter()
    const read = (key: string) => (typeof router.query[key] === "string" ? router.query[key] : "")
    const workspaceId = read("workspace_id")
    const projectId = read("project_id")
    if (!workspaceId || !projectId || !read("app_id")) return null
    return (
        <DeveloperViewGate viewId="evaluations" betaOnly>
            <EvaluationsRoute workspaceId={workspaceId} projectId={projectId} />
        </DeveloperViewGate>
    )
}
