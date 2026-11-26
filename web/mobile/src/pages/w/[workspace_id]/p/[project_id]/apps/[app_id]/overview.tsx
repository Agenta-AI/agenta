import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {DeveloperViewGate} from "@/features/developer/DeveloperViewGate"

// The overview downloads only for a reader who may open it: a hidden view loads none of it.
const AppOverviewScreen = dynamic(
    () => import("@/features/app-overview/AppOverviewScreen").then((m) => m.AppOverviewScreen),
    {ssr: false},
)

export default function AppOverviewPage() {
    const router = useRouter()
    const read = (key: string) => (typeof router.query[key] === "string" ? router.query[key] : "")
    const workspaceId = read("workspace_id")
    const projectId = read("project_id")
    const appId = read("app_id")
    if (!workspaceId || !projectId || !appId) return null
    return (
        <DeveloperViewGate viewId="app-overview">
            <AppOverviewScreen workspaceId={workspaceId} projectId={projectId} appId={appId} />
        </DeveloperViewGate>
    )
}
