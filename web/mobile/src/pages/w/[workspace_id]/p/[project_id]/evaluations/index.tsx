import {useRouter} from "next/router"

import {DeveloperViewGate} from "@/features/developer/DeveloperViewGate"
import {EvaluationsRoute} from "@/features/evaluations/new/EvaluationsRoute"

export default function EvaluationsPage() {
    const router = useRouter()
    const workspaceId =
        typeof router.query.workspace_id === "string" ? router.query.workspace_id : ""
    const projectId = typeof router.query.project_id === "string" ? router.query.project_id : ""
    if (!workspaceId || !projectId) return null
    return (
        <DeveloperViewGate viewId="evaluations">
            <EvaluationsRoute workspaceId={workspaceId} projectId={projectId} />
        </DeveloperViewGate>
    )
}
