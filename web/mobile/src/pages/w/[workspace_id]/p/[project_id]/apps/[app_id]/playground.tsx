import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {DeveloperViewGate} from "@/features/developer/DeveloperViewGate"
import {AppShell} from "@/features/nav/AppShell"
import {PlaygroundSkeleton} from "@/features/playground/states/PlaygroundSkeleton"

// The playground is the heaviest view, so its code loads only when the view is on and the page renders it.
const PlaygroundScreen = dynamic(
    () => import("@/features/playground/PlaygroundScreen").then((m) => m.PlaygroundScreen),
    {ssr: false, loading: () => <PlaygroundSkeleton />},
)

export default function PlaygroundPage() {
    const router = useRouter()
    const workspaceId =
        typeof router.query.workspace_id === "string" ? router.query.workspace_id : ""
    const projectId = typeof router.query.project_id === "string" ? router.query.project_id : ""
    const appId = typeof router.query.app_id === "string" ? router.query.app_id : ""
    if (!workspaceId || !projectId || !appId) return null
    return (
        <DeveloperViewGate viewId="playground">
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <PlaygroundScreen workspaceId={workspaceId} projectId={projectId} appId={appId} />
            </AppShell>
        </DeveloperViewGate>
    )
}
