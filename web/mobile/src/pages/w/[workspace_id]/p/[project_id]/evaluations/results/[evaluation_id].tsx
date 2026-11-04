import {useRouter} from "next/router"

import {DeveloperViewGate} from "@/features/developer/DeveloperViewGate"
import {RunDetailsScreen} from "@/features/evaluation-run/RunDetailsScreen"

export default function EvaluationRunPage() {
    const router = useRouter()
    const param = (key: string) =>
        typeof router.query[key] === "string" ? (router.query[key] as string) : ""
    const workspaceId = param("workspace_id")
    const projectId = param("project_id")
    const runId = param("evaluation_id")
    if (!workspaceId || !projectId || !runId) return null
    return (
        <DeveloperViewGate viewId="evaluations">
            <RunDetailsScreen workspaceId={workspaceId} projectId={projectId} runId={runId} />
        </DeveloperViewGate>
    )
}
