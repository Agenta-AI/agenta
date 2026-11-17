import {useRouter} from "next/router"

import {DeveloperViewGate} from "@/features/developer/DeveloperViewGate"
import {VariantsScreen} from "@/features/variants/VariantsScreen"

/** The app's Registry, as in the old app. The screen reads the app from the path. */
export default function AppVariantsPage() {
    const router = useRouter()
    const read = (key: string) => (typeof router.query[key] === "string" ? router.query[key] : "")
    const workspaceId = read("workspace_id")
    const projectId = read("project_id")
    if (!workspaceId || !projectId || !read("app_id")) return null
    return (
        <DeveloperViewGate viewId="variants" betaOnly>
            <VariantsScreen workspaceId={workspaceId} projectId={projectId} />
        </DeveloperViewGate>
    )
}
