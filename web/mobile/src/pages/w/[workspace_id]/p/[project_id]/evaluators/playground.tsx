import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {DeveloperViewGate} from "@/features/developer/DeveloperViewGate"
import {AppShell} from "@/features/nav/AppShell"
import {PlaygroundSkeleton} from "@/features/playground/states/PlaygroundSkeleton"

// The same module as the app playground, so both routes share one chunk. It loads only when the
// view is on and the page renders it.
const PlaygroundScreen = dynamic(
    () => import("@/features/playground/PlaygroundScreen").then((m) => m.PlaygroundScreen),
    {ssr: false, loading: () => <PlaygroundSkeleton />},
)

export default function EvaluatorPlaygroundPage() {
    const router = useRouter()
    const workspaceId =
        typeof router.query.workspace_id === "string" ? router.query.workspace_id : ""
    const projectId = typeof router.query.project_id === "string" ? router.query.project_id : ""
    if (!workspaceId || !projectId) return null
    return (
        <DeveloperViewGate viewId="evaluator-playground">
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <PlaygroundScreen
                    mode="evaluator"
                    workspaceId={workspaceId}
                    projectId={projectId}
                />
            </AppShell>
        </DeveloperViewGate>
    )
}
